$(document).ready(function() {
    var socket = io.connect('http://' + document.domain + ':' + location.port);
    var currentData = {};
    let monitoredTags = new Set();
    var isCheckboxAdded = false;
    var isInteracting = false;
    var allData = [];
    let currentSearchValue = '';

    socket.on('connect', function() {
        console.log('WebSocket connected successfully.');
        $('#status-indicator').removeClass('status-red').addClass('status-green');
    });

    socket.on('disconnect', function() {
        console.error('WebSocket disconnected.');
        $('#status-indicator').removeClass('status-green').addClass('status-red');
    });

    $('#monitor-btn').click(function() {
        if (!isCheckboxAdded) {
            isCheckboxAdded = true;
            $(this).removeClass('btn-outline-primary').addClass('btn-danger');
            updateTable();
            socket.emit('monitor');
        } else {
            stopMonitor();
            $(this).removeClass('btn-danger').addClass('btn-outline-primary');
        }
    });

    // Toggle search box visibility
    $('#search-toggle-btn').click(function() {
        $('#search-container').toggle();
        $('#search-input').focus();
    });

    // Clear search input
    $('#clear-search').click(function() {
        $('#search-input').val('').trigger('input');
    });

    $(document).on('change', '.monitor-checkbox', function() {
        let tag = $(this).data('tag');
        if ($(this).is(':checked')) {
            monitoredTags.add(tag);
            socket.emit('tag_control', { tag: tag, control: true });
        } else {
            monitoredTags.delete(tag);
            socket.emit('tag_control', { tag: tag, control: false });
            if (currentData[tag]) {
                currentData[tag].inputValue = '';
            }
        }
        updateTable();
    });

    $(document).on('click', '.ok-btn', function(event) {
        event.stopPropagation();
        let value = $(this).siblings('.entry-input').val();
        let tag = $(this).data('tag');
        if (value) {
            console.log('Send data to OPCUA:', tag, value);
            socket.emit('set_tag_value', { tag: tag, value: value });
        }
        if (currentData[tag]) {
            currentData[tag].value = value;
            currentData[tag].inputValue = '';
        }
        $(this).siblings('.entry-input').val('');
    });

    $(document).on('input', '.entry-input', function() {
        let tag = $(this).data('tag');
        let value = $(this).val();
        if (value.startsWith('.') && value.length === 1) {
            value = '0.';
        }
        value = value.replace(/[^0-9.]/g, '');
        let decimalCount = (value.match(/\./g) || []).length;
        if (decimalCount > 1) {
            value = value.slice(0, -1);
        }
        $(this).val(value);
        if (currentData[tag]) {
            currentData[tag].inputValue = value;
        }
    });

    $(document).on('focus', '.entry-input', function() {
        isInteracting = true;
    });

    $(document).on('blur', '.entry-input', function() {
        isInteracting = false;
    });

    $('#search-input').on('input', function() {
        currentSearchValue = $(this).val().toLowerCase();
        updateTable();
    });

    function stopMonitor() {
        $('.monitor-checkbox').prop('checked', false).trigger('change');
        monitoredTags.clear();
        isCheckboxAdded = false;
        $('table tbody tr td:first-child').remove();
        updateTable();
    }

    socket.on('monitor_timeout', function(data) {
        console.log('Monitor timeout:', data.message);
        let counter = 10;
        let countdown = setInterval(function() {
            if (counter === 0) {
                clearInterval(countdown);
                stopMonitor();
            } else {
                console.log('倒數:', counter);
                counter--;
            }
        }, 1000);
        if (confirm(data.message)) {
            clearInterval(countdown);
            isCheckboxAdded = false;
            $('#monitor-btn').click();
        } else {
            clearInterval(countdown);
            stopMonitor();
        }
    });

    var updateScheduled = false;
    function scheduleTableUpdate() {
        if (!updateScheduled && !isInteracting) {
            updateScheduled = true;
            setTimeout(function() {
                updateTable();
                updateScheduled = false;
            }, 100);
        }
    }

    socket.on('mqtt_message', function(messages) {
        messages.forEach(function(data) {
            var tag = data.Tag;
            if (!currentData[tag]) {
                currentData[tag] = {};
            }
            if (!monitoredTags.has(tag)) {
                currentData[tag].value = data.Value;
            }
            currentData[tag].sourcetime = data.SourceTime.split('.')[0]; // Remove milliseconds
            currentData[tag].status = data.Quality;
            currentData[tag].IECPath = data.IECPath;
            currentData[tag].OpcuaNode = tag;
            currentData[tag].inputValue = currentData[tag].inputValue || '';
            if (!allData.some(item => item.OpcuaNode === tag)) {
                allData.push(currentData[tag]);
            }
        });
        scheduleTableUpdate();
    });

    $.getJSON('/tree_data', function(response) {
        var treeData = response.treeData;
        var jsFormatData = response.treeJsFormat;
        buildTreeView(treeData, jsFormatData);
    }).fail(function(jqXHR, textStatus, errorThrown) {
        console.error("Error fetching tree data: " + textStatus, errorThrown);
    });

    var nodeIdCounter = 1;
    function buildNodeIdMap(nodes, map) {
        nodes.forEach(function(node) {
            node.nodeId = nodeIdCounter;
            map[node.nodeId] = node;
            nodeIdCounter++;
            if (node.nodes) {
                buildNodeIdMap(node.nodes, map);
            }
        });
    }

    function buildTreeView(treeData, treeData2Js) {
        var nodeIdMap = {};
        buildNodeIdMap(treeData2Js, nodeIdMap);
        if (treeData2Js) {
            $('#treeview1').treeview({
                data: treeData2Js,
                collapseIcon:'fas fa-solid fa-caret-down',
                expandIcon:'fas fa-solid fa-caret-right',
                onNodeSelected: function(event, data) {
                    var parentNodeId = data.parentId;
                    var ied;
                    if (parentNodeId != null) {
                        ied = nodeIdMap[parentNodeId+1].text;
                        var type = data.text;
                        var items = treeData[ied][type];
                        console.log('Selected items:', items);
                        var topic = 'Topic/' + type + '/' + ied;
                        socket.emit('subscribe', { topic: topic });
                    } else {
                        ied = data.text;
                        return;
                    }

                    currentData = {};
                    monitoredTags.clear();
                    items.forEach(function(item) {                
                        currentData[item.OpcuaNode] = item;
                        currentData[item.OpcuaNode].inputValue = '';
                    });

                    updateTable();
                }
            });
        } else {
            console.error("Failed to load tree data");
        }
    }

    function highlightMatch(text, searchTerm) {
        if (!searchTerm) return text;
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<span class="highlight">$1</span>');
    }


    function updateTable(data = Object.values(currentData)) {
        // 如果有搜索条件，先过滤数据
        if (currentSearchValue) {
            data = data.filter(function(item) {
                return Object.values(item).some(function(val) {
                    return String(val).toLowerCase().includes(currentSearchValue);
                });
            });
        }
    
        // 计算是否所有的复选框都被选中
        var allTags = data.map(item => item.OpcuaNode);
        var allChecked = allTags.length > 0 && allTags.every(tag => monitoredTags.has(tag));
    
        var tableHtml = '<thead><tr>';
        if (isCheckboxAdded) {
            tableHtml += `
                <th style="width: 50px; padding: 0; margin: 0;">
                    <div style="display: flex; align-items: flex-start; justify-content: center;">
                        <input type="checkbox" id="select-all-checkbox" style="margin: 7px;"  ${allChecked ? 'checked' : ''}>
                    </div>
                </th>`;
        }
        tableHtml += '<th style="width: 80px;">Tag</th>';
        tableHtml += '<th style="width: 100px;">Value</th>';
        tableHtml += '<th style="width: 200px;">SourceTime</th>';
        tableHtml += '<th style="width: 100px;">Status</th>';
        tableHtml += '<th style="width: 500px;">IECPath</th>';
        if (isCheckboxAdded) {
            tableHtml += '<th style="width: 150px;">Input</th>';
        }
        tableHtml += '</tr></thead><tbody>'; // 正确地关闭<tr>和</thead>
    
        // 构建表格主体
        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            tableHtml += '<tr>';
            if (isCheckboxAdded) {
                tableHtml += '<td><input type="checkbox" class="monitor-checkbox" data-tag="' + item.OpcuaNode + '"' + (monitoredTags.has(item.OpcuaNode) ? ' checked' : '') + '></td>';
            }
            tableHtml += '<td>' + highlightMatch(item.OpcuaNode, currentSearchValue) + '</td>';
            tableHtml += '<td>' + highlightMatch(item.value || '', currentSearchValue) + '</td>';
            tableHtml += '<td>' + highlightMatch((item.sourcetime || '').split('.')[0], currentSearchValue) + '</td>'; // 去除毫秒部分
            tableHtml += '<td>' + highlightMatch(item.status || '', currentSearchValue) + '</td>';
            tableHtml += '<td>' + highlightMatch(item.IECPath, currentSearchValue) + '</td>';
    
            if (isCheckboxAdded) {
                if (monitoredTags.has(item.OpcuaNode)) {
                    tableHtml += '<td>';
                    tableHtml += '<div class="input-group">';
                    tableHtml += '<input type="text" class="form-control entry-input" placeholder="輸入值" data-tag="' + item.OpcuaNode + '" value="' + (item.inputValue || '') + '">';
                    tableHtml += '<button class="btn btn-success ok-btn" data-tag="' + item.OpcuaNode + '">OK</button>';
                    tableHtml += '</div>';
                    tableHtml += '</td>';
                } else {
                    tableHtml += '<td></td>'; // 如果未选中，添加一个空的<td>
                }
            }
    
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody>';
    
        $('#data-table').html(tableHtml);
    
        // 绑定全选复选框的事件处理程序
        $('#select-all-checkbox').on('change', function() {
            var isChecked = $(this).is(':checked');
    
            if (isChecked) {
                // 将当前显示的数据中的所有标签添加到monitoredTags
                data.forEach(function(item) {
                    monitoredTags.add(item.OpcuaNode);
                    socket.emit('tag_control', { tag: item.OpcuaNode, control: true });
                });
            } else {
                // 从monitoredTags中移除当前显示的数据中的所有标签
                data.forEach(function(item) {
                    monitoredTags.delete(item.OpcuaNode);
                    socket.emit('tag_control', { tag: item.OpcuaNode, control: false });
                    if (currentData[item.OpcuaNode]) {
                        currentData[item.OpcuaNode].inputValue = '';
                    }
                });
            }
    
            // 更新DOM中的子复选框状态
            $('.monitor-checkbox').prop('checked', isChecked);
    
            // 重新调用updateTable()更新表格显示
            updateTable();
        });
    
        // 子复选框的事件处理程序
        $(document).on('change', '.monitor-checkbox', function() {
            let tag = $(this).data('tag');
            if ($(this).is(':checked')) {
                monitoredTags.add(tag);
                socket.emit('tag_control', { tag: tag, control: true });
            } else {
                monitoredTags.delete(tag);
                socket.emit('tag_control', { tag: tag, control: false });
                if (currentData[tag]) {
                    currentData[tag].inputValue = '';
                }
            }
    
            // 检查是否所有子复选框都被选中
            var allTags = data.map(item => item.OpcuaNode);
            var allChecked = allTags.length > 0 && allTags.every(tag => monitoredTags.has(tag));
    
            // 更新全选复选框的状态
            $('#select-all-checkbox').prop('checked', allChecked);
        });
    }
    
});
