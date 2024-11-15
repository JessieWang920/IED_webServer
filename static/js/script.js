let monitoredTags = new Set();
var socket;


$(document).ready(function() {

    let isDebugMode = false;
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
    var allTagsData = {};  

    let isSearching = false;
    let previousSubscriptionTopic = null;
    let currentSubscriptionTopic = null


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
            startMonitoring();
        } else {
            stopMonitor();
            $btn.removeClass('btn-danger').addClass('btn-outline-primary').text('Simulator');
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
                $('#continueModal').modal('hide');
                stopMonitor();
                $btn.removeClass('btn-danger').addClass('btn-outline-primary').text('Simulator');
            }
        }, 1000);
    }

    function updateButtonText(seconds) {
        const $btn = $('#monitor-btn');
        $btn.text(`Simulator (${formatTime(seconds)})`);
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
            }
        }, 1000);
    }
    
    $('#continue-btn').click(function() {
        // 用戶選擇繼續監控
        clearInterval(modalCountdownInterval);
        $('#continueModal').modal('hide');
        resetCountdown();
    });
    $('#stop-btn').click(function() {
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
        $('#data-table').empty();
        if (!isSearching){
            $('#search-input').focus();
        }else{            
            isSearching = false;
            $('#search-input').val('').trigger('input');
            updateTable();
        }
    });

    // Clear search input
    $('#clear-search').click(function() {
        $('#search-input').val('').trigger('input');
    });

    // 監聽單個checkbox 變更事件
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
        updateTable(); 
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

        if (value === '-')  {
            alert('無法輸入單一負號，請輸入有效值');
            return;
        }
        if (value === '')  {
            alert('請輸入有效值');
            return;
        }

        isInteracting = false;
        if (value) {
            socket.emit('set_tag_value', { tag: tag, value: value });
        }
        console.log('current tag :',currentData[tag])
        if (currentData[tag]) {
            currentData[tag].value = parseFloat(value);
            const now = new Date();
            const formattedTime = now.getFullYear() + "-" +
                String(now.getMonth() + 1).padStart(2, '0') + "-" +
                String(now.getDate()).padStart(2, '0') + " " +
                String(now.getHours()).padStart(2, '0') + ":" +
                String(now.getMinutes()).padStart(2, '0') + ":" +
                String(now.getSeconds()).padStart(2, '0');
            currentData[tag].sourcetime = formattedTime;
            currentData[tag].status = 'Good';
            currentData[tag].inputValue = '';
        }
        if (allTagsData[tag]){
            allTagsData[tag].value = parseFloat(value);
            allTagsData[tag].inputValue = '';
        }
        $(this).siblings('.entry-input').val('');
        updateTable();
    });

    $(document).on('input', '.entry-input', function() {
        let tag = $(this).data('tag');
        let value = $(this).val();
        // 如果輸入以負號開頭，保留負號，否則移除
        if (value.startsWith('-')) {
            // 保留負號，並移除其餘部分的非數字和非小數點字符
            value = '-' + value.slice(1).replace(/[^0-9.]/g, '');
        } else {
            // 移除所有非數字和非小數點字符
            value = value.replace(/[^0-9.]/g, '');
        }
        // 處理以小數點開頭的情況
        if (value.startsWith('.') && value.length === 1) {
            value = '0.';
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
            $(this).closest('.input-group').find('.ok-btn').click(); // 觸發OK
        }
    });

    $(document).on('focus', '.entry-input', function() {
        isInteracting = true;
    });

    $(document).on('blur', '.entry-input', function() {
        isInteracting = false;
    });

    // 在搜尋輸入框上的 focus 事件
    $('#search-input').on('focus', function() {
        isSearching = true;
        previousSubscriptionTopic = currentSubscriptionTopic;
        currentSubscriptionTopic = 'Topic/#';
        socket.emit('subscribe', { topic: currentSubscriptionTopic });
    });

    $('#search-input').on('input', function() {
        currentSearchValue = $(this).val().toLowerCase();
        console.log('currentSearchValue:', currentSearchValue);
        if (currentSearchValue) {
            updateTable();
        } else {
            $('#data-table').empty();
        }
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
        updateMonitoredTagsOnServer(); 
        // 更新表格中復選框狀態
        $('.monitor-checkbox').prop('checked', false);
        isCheckboxAdded = false;
        $('#monitor-btn').removeClass('btn-danger').addClass('btn-outline-primary').text('Simulator');
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


    socket.on('mqtt_message', function(messages) {
        console.log('Received MQTT message:', messages);
        messages.forEach(function(data) {
            var tag = data.Tag;
            // 更新 allTagsData
            if (!allTagsData[tag]) {
                console.log(5)
                allTagsData[tag] = {
                    OpcuaNode: tag,
                    IECPath: data.IECPath,
                    value: data.Value,
                    status: data.Quality,
                    sourcetime: data.SourceTime.split('.')[0],
                    inputValue: ''
                };
            } 
            else {
                if (!monitoredTags.has(tag)){
                    allTagsData[tag].value = data.Value;
                    allTagsData[tag].sourcetime = data.SourceTime.split('.')[0];
                    allTagsData[tag].status = data.Quality;
                }
            }
            // 如果標籤存在於 currentData，則更新
            if (currentData[tag] && !monitoredTags.has(tag)) {
                currentData[tag].value = data.Value;
                currentData[tag].sourcetime = data.SourceTime.split('.')[0];
                currentData[tag].status = data.Quality;
            }
            // if (!currentData[tag]) {
            //     currentData[tag] = {
            //     OpcuaNode: tag,
            //     IECPath: data.IECPath,
            //     inputValue: ''
            //     };
            // }

            // // 更新 monitoredTags
            // if (monitoredTags.has(tag)) {
            //     if (!currentData[tag]) {
            //         currentData[tag] = {
            //             OpcuaNode: tag,
            //             IECPath: data.IECPath,
            //             inputValue: ''
            //         };
            //     }
            //     currentData[tag].value = data.Value;
            //     currentData[tag].sourcetime = data.SourceTime.split('.')[0];
            //     currentData[tag].status = data.Quality;
            // }
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

    // 從整個 treeData 加載所有checkbox標籤
    function loadAllTagsData(treeData) {
        for (let iedKey in treeData) {
            let ied = treeData[iedKey];
            for (let type in ied) {
                let items = ied[type];
                console.log('all tags data:',allTagsData)
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
                    // 清空search
                    isSearching = false;
                    $('#search-input').val('');
                    currentSearchValue = ''; 

                    var parentNodeId = data.parentId;
                    var ied,type,items, topic;               

                    if (parentNodeId != null) {
                        // 子節點
                        ied = nodeIdMap[parentNodeId+1].text;
                        type = data.text;
                        items = treeData[ied][type];
                        // console.log('Selected items:', items);
                        // console.log(treeData)
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
                                items.push({
                                    ...item,
                                    Type: type 
                                });
                            });
                        }
                        console.log('Subscribing to topic:', topic);
                        socket.emit('subscribe', { topic: topic });                        
                    }

                    currentSubscriptionTopic = topic; // 更新當前訂閱主題
                    currentData = {};
                    items.forEach(function(item) {                
                        // currentData[item.OpcuaNode] = item;
                        // currentData[item.OpcuaNode].inputValue = '';     
                        var tag = item.OpcuaNode;
                        if (allTagsData[tag]) {
                            // Use the updated data from allTagsData
                            currentData[tag] = Object.assign({}, allTagsData[tag]);
                        } else {
                            // Use the original item data
                            currentData[tag] = item;
                        }
                        currentData[tag].inputValue = '';   
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

    function naturalSort(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    function updateTable() {
        var data;
        // 如果有搜索條件，先過濾
        if (isSearching) {
            if (currentSearchValue) {
                data = Object.values(allTagsData).filter(function(item) {
                    // return Object.values(item).some(function(val) {
                    //     return String(val).toLowerCase().includes(currentSearchValue);
                    // });
                    return ['IECPath', 'OpcuaNode'].some(function(key) {
                        return String(item[key] || '').toLowerCase().includes(currentSearchValue.toLowerCase());
                    });
                });
            } else {
                // $('#data-table').empty();
                return;
            }
        } else {
            data = Object.values(currentData);
        }
        data.sort(function(a, b) {
            // if (a.OpcuaNode < b.OpcuaNode) return -1;
            // if (a.OpcuaNode > b.OpcuaNode) return 1;
            // return 0;
            return naturalSort(a.OpcuaNode, b.OpcuaNode);
        });
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
            tableHtml += '<td>' + item.value || '', currentSearchValue + '</td>';
            tableHtml += '<td>' + (item.sourcetime || '').split('.')[0], currentSearchValue + '</td>'; // 去除毫秒部分
            tableHtml += '<td>' + item.status || '', currentSearchValue + '</td>';
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


