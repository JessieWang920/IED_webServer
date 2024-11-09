let monitoredTags = new Set();
var socket;


$(document).ready(function() {

    let isDebugMode = true;
    if (!isDebugMode) {
        console.log = function() {};
    }

    socket = io.connect('http://' + document.domain + ':' + location.port);
    var currentData = {};
    
    var isCheckboxAdded = false;
    var isInteracting = false;
    var allData = [];
    let currentSearchValue = '';
    let isMonitoring = false;
    let countdown = 300; // 5分鐘（以秒為單位）
    let countdownInterval;
    let modalCountdownInterval;
    var allTagsData = [];  // 用於存儲所有 IED 的標籤和路徑資料

    socket.on('connect', function() {
        console.log('WebSocket connected successfully.');
        $('#status-indicator').removeClass('status-red').addClass('status-green');
        updateMonitoredTagsOnServer();
    });

    socket.on('disconnect', function() {
        console.error('WebSocket disconnected.');
        $('#status-indicator').removeClass('status-green').addClass('status-red');
    });

    $('#monitor-btn').click(function() {
        const $btn = $(this);
        if (!isMonitoring && !isCheckboxAdded){
            isMonitoring = true;
            isCheckboxAdded = true;
            $btn.removeClass('btn-outline-primary').addClass('btn-danger');
            updateTable();
            // socket.emit('monitor'); // 如果需要，取消註釋此行

            startMonitoring();
        } else {
            stopMonitor();
            $btn.removeClass('btn-danger').addClass('btn-outline-primary').text('Monitor');
        }
    });

    function startMonitoring() {
        const $btn = $('#monitor-btn');
        countdown = 300; // 重置為5分鐘
        updateButtonText(countdown);

        countdownInterval = setInterval(function() {
            countdown--;
            if (countdown > 0) {
                updateButtonText(countdown);
                if (countdown === 10) { // 當剩餘10秒時，顯示模態框
                    showContinuePrompt();
                }
            } else {
                clearInterval(countdownInterval);
                // alert('Timeout - 自動停止monitor');
                $('#continueModal').modal('hide');
                stopMonitor();
                $btn.removeClass('btn-danger').addClass('btn-outline-primary').text('Monitor');
            }
        }, 1000);
    }

    function updateButtonText(seconds) {
        const $btn = $('#monitor-btn');
        $btn.text(`Monitor (${formatTime(seconds)})`);
    }
    
    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? '0' + secs : secs}`;
    }
    
    function showContinuePrompt() {
        // 顯示模態框
        $('#continueModal').modal('show');
        let modalCountdown = 10;
        $('#modalCountdown').text(modalCountdown);
    
        // 每秒更新模態框中的倒數計時
        modalCountdownInterval = setInterval(function() {
            modalCountdown--;
            $('#modalCountdown').text(modalCountdown);
            if (modalCountdown <= 0) {
                clearInterval(modalCountdownInterval);
                $('#continueModal').modal('hide');
                stopMonitor();
                // $('#monitor-btn').removeClass('btn-danger').addClass('btn-outline-primary').text('Monitor');
            }
        }, 1000);
    }
    
    $('#continueBtn').click(function() {
        // 用戶選擇繼續監控
        clearInterval(modalCountdownInterval);
        $('#continueModal').modal('hide');
        resetCountdown();
    });
    $('#stopBtn').click(function() {
        clearInterval(modalCountdownInterval);
        $('#continueModal').modal('hide');
        stopMonitor();
    });
    
    function resetCountdown() {
        clearInterval(countdownInterval);
        startMonitoring();
    }

    // Toggle search box visibility
    $('#search-toggle-btn').click(function() {
        $('#search-container').toggle();
        $('#search-input').focus();
    });

    // Clear search input
    $('#clear-search').click(function() {
        $('#search-input').val('').trigger('input');
    });

    // 監聽單個復選框變更事件（使用事件委派）
    $(document).on('change', '.monitor-checkbox', function() {
        let tag = $(this).data('tag');
        // console.log('Tag control:', tag, $(this).is(':checked'));
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
        updateMonitoredTagsOnServer(); // 更新伺服器端的 monitoredTags

        // 檢查是否所有子復選框都被選中
        var allTags = Object.values(currentData).map(item => item.OpcuaNode);
        var allChecked = allTags.length > 0 && allTags.every(tag => monitoredTags.has(tag));

        // 更新全選復選框的狀態
        $('#select-all-checkbox').prop('checked', allChecked);
    });

    function updateMonitoredTagsOnServer() {
        socket.emit('update_monitored_tags', { tags: Array.from(monitoredTags) });
    }
    // 監聽全選復選框變更事件（使用事件委派）
    $(document).on('change', '#select-all-checkbox', function() {
        var isChecked = $(this).is(':checked');

        // 防止重複觸發子復選框的change事件
        $('.monitor-checkbox').each(function() {
            var tag = $(this).data('tag');
            if (isChecked) {
                if (!monitoredTags.has(tag)) {
                    monitoredTags.add(tag);
                    socket.emit('tag_control', { tag: tag, control: true });
                }
            } else {
                if (monitoredTags.has(tag)) {
                    monitoredTags.delete(tag);
                    socket.emit('tag_control', { tag: tag, control: false });
                    if (currentData[tag]) {
                        currentData[tag].inputValue = '';
                    }
                }
            }
            updateMonitoredTagsOnServer(); // 更新伺服器端的 monitoredTags

            // 設置子復選框的狀態
            $(this).prop('checked', isChecked);
        });

        // 重新調用updateTable()更新表格顯示
        updateTable();
    });

    $(document).on('click', '.ok-btn', function(event) {
        event.stopPropagation();
        let value = $(this).siblings('.entry-input').val();
        let tag = $(this).data('tag');
        if (value) {
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
        let originalValue = value; // 保存原始值以便比較


        // 如果輸入以負號開頭，保留負號，否則移除
        if (value.startsWith('-')) {
            // 保留負號，並移除其餘部分的非數字和非小數點字符
            value = '-' + value.slice(1).replace(/[^0-9.]/g, '');
        } else {
            // 移除所有非數字和非小數點字符
            value = value.replace(/[^0-9.]/g, '');
        }

        // 處理單獨的負號
        if (value === '-') {
            // 允許單獨的負號，暫時不進行其他處理
        } else {
            // 處理以小數點開頭的情況
            if (value.startsWith('.') && value.length === 1) {
                value = '0.';
            }
        }

        let decimalCount = (value.match(/\./g) || []).length;
        if (decimalCount > 1) {
            value = value.slice(0, -1);
        }
        $(this).val(value);
        if (currentData[tag]) {
            currentData[tag].inputValue = value;
        }   
    });

    $(document).on('keydown', '.entry-input', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // 防止表單提交或其他默認行為
            $(this).closest('.input-group').find('.ok-btn').click(); // 觸發相應的 OK 按鈕
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
        isMonitoring = false;
        clearInterval(countdownInterval);
        clearInterval(modalCountdownInterval);
        // 取消所有已經監控的標籤
        monitoredTags.forEach(tag => {
            socket.emit('tag_control', { tag: tag, control: false });
        });
        monitoredTags.clear(); // 清空已監控的標籤集合
        updateMonitoredTagsOnServer(); // 更新伺服器端的 monitoredTags
        // 更新表格中復選框狀態
        $('.monitor-checkbox').prop('checked', false);
        isCheckboxAdded = false;
        $('#monitor-btn').removeClass('btn-danger').addClass('btn-outline-primary').text('Monitor');
        $('table tbody tr td:first-child').remove();

        updateTable();
    }

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
    // socket.on('lient_close', function() {
    //     stopMonitor();
    // });


    socket.on('mqtt_message', function(messages) {
        messages.forEach(function(data) {
            var tag = data.Tag;
            if (!currentData[tag]) {
                currentData[tag] = {};
            }
            if (!monitoredTags.has(tag)) {
                currentData[tag].value = data.Value;
                currentData[tag].sourcetime = data.SourceTime.split('.')[0]; // Remove milliseconds

            }
            // currentData[tag].sourcetime = data.SourceTime.split('.')[0]; // Remove milliseconds
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
        loadAllTagsData(treeData);
    }).fail(function(jqXHR, textStatus, errorThrown) {
        console.error("Error fetching tree data: " + textStatus, errorThrown);
    });

    // 新增的函數，用於從整個 treeData 中加載所有標籤
    function loadAllTagsData(treeData) {
        for (let iedKey in treeData) {
            let ied = treeData[iedKey];
            for (let type in ied) {
                let items = ied[type];
                items.forEach(function (item) {
                    allTagsData.push({
                        OpcuaNode: item.OpcuaNode,
                        IECPath: item.IECPath,
                        value: item.value || '',
                        status: item.status || '',
                        sourcetime: item.sourcetime || ''
                    });
                });
            }
        }
        console.log('All tags data loaded:', allTagsData);
    }

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
                    var ied,type,items, topic;               

                    if (parentNodeId != null) {
                        // 子節點
                        // 根據您的資料結構調整索引
                        ied = nodeIdMap[parentNodeId+1].text;
                        type = data.text;
                        items = treeData[ied][type];
                        console.log('Selected items:', items);
                        console.log(treeData)
                        topic = 'Topic/' + type + '/' + ied;
                        console.log('Subscribing to topic:', topic);
                        socket.emit('subscribe', { topic: topic });
                    } else {
                        // 父節點
                        ied = data.text;
                        topic = 'Topic/+/'+ ied;
                        items = [];

                        for (const [type, items_temp] of Object.entries(treeData[ied])) {
                            items_temp.forEach(item => {
                                // 可選：確保每個項目都包含 Type 屬性
                                items.push({
                                    ...item,
                                    Type: type // 若每個項目已包含 Type 屬性，可省略此行
                                });
                            });
                        }
                        console.log('Subscribing to topic:', topic);
                        socket.emit('subscribe', { topic: topic });                        
                    }

                    currentData = {};
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
        // 如果有搜索條件，先過濾數據
        if (currentSearchValue) {
            const searchTerm = currentSearchValue.toLowerCase();
            data = allTagsData.filter(function(item) {
                return Object.values(item).some(function(val) {
                    return String(val).toLowerCase().includes(currentSearchValue);
                });
            });
        }
    
        // 計算是否所有的復選框都被選中
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
        tableHtml += '</tr></thead><tbody>'; // 正確地關閉<tr>和</thead>
    
        // 構建表格主體
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
                    tableHtml += '<input type="text" class="form-control entry-input" placeholder="輸入數值" data-tag="' + item.OpcuaNode + '" value="' + (item.inputValue || '') + '">';
                    tableHtml += '<button class="btn btn-success ok-btn" data-tag="' + item.OpcuaNode + '">OK</button>';
                    tableHtml += '</div>';
                    tableHtml += '</td>';
                } else {
                    tableHtml += '<td></td>'; // 如果未選中，添加一個空的<td>
                }
            }
    
            tableHtml += '</tr>';
        }
        tableHtml += '</tbody>';
    
        $('#data-table').html(tableHtml);
    }


});


