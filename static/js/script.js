$(document).ready(function() {
    var socket = io.connect('http://' + document.domain + ':' + location.port);
    var currentData = {};
    let monitoredTags = new Set();
    var isCheckboxAdded = false; // 記錄是否已經插入 checkbox
    var isInteracting = false; // 標記用戶是否在與輸入欄位交互

    socket.on('connect', function() {
        console.log('WebSocket connected successfully.');
        $('#status-indicator').removeClass('status-red').addClass('status-green');
    });

    socket.on('disconnect', function() {
        console.error('WebSocket disconnected.');
        $('#status-indicator').removeClass('status-green').addClass('status-red');
    });

    // 監聽 Monitor 按鈕
    $('#monitor-btn').click(function() {
        if (!isCheckboxAdded) {
            isCheckboxAdded = true;
            $(this).removeClass('btn-outline-primary').addClass('btn-danger'); // 從藍色變為綠色
            updateTable(); // 重新渲染表格以包含複選框
            socket.emit('monitor');
        }
        else{
            stopMonitor();
            $(this).removeClass('btn-danger').addClass('btn-outline-primary'); // 恢復藍色
        }
    });

    // 監聽複選框的變化
    $(document).on('change', '.monitor-checkbox', function() {
        let tag = $(this).data('tag');
        if ($(this).is(':checked')) {
            monitoredTags.add(tag);
            socket.emit('tag_control', { tag: tag, control: true });
        } else {
            monitoredTags.delete(tag);
            socket.emit('tag_control', { tag: tag, control: false });
            if (currentData[tag]) {
                currentData[tag].inputValue = ''; // 清除輸入值
            }
        }
        updateTable(); // 重新渲染表格以反映變化
    });

    // 處理 OK 按鈕的點擊
    $(document).on('click', '.ok-btn', function(event) {
        event.stopPropagation(); // 防止事件冒泡
        let value = $(this).siblings('.entry-input').val();
        // 要修正表格 title header
        let tag = $(this).data('tag');
        if (value) {
            // let tag = $(this).closest('tr').find('td:nth-child(2)').text();
            console.log('Send data to OPCUA:', tag, value);
            socket.emit('set_tag_value', { tag: tag, value: value });
        }
        // 本地更新該 tag 的值
        if (currentData[tag]) {
            currentData[tag].value = value;
            currentData[tag].inputValue = ''; // 清除輸入值
        }

        // 清除輸入框
        $(this).siblings('.entry-input').val('');
        
    });

    // 監聽輸入框的輸入事件，保存輸入值
    $(document).on('input', '.entry-input', function() {
        let tag = $(this).data('tag');
        let value = $(this).val();
        
        // 如果以小數點開始，自動補全為 "0."
        if (value.startsWith('.') && value.length === 1) {
            value = '0.';
        }

        // 過濾輸入值，只允許數字和小數點
        value = value.replace(/[^0-9.]/g, '');

        // 防止輸入多個小數點
        let decimalCount = (value.match(/\./g) || []).length;
        if (decimalCount > 1) {
            value = value.slice(0, -1);  // 刪除最後一個輸入的小數點
        }
        $(this).val(value); // 將過濾後的值重新賦予輸入框
        if (currentData[tag]) {
            currentData[tag].inputValue = value;
        }
    });

    // 當輸入框獲得焦點時，設置 isInteracting 為 true
    $(document).on('focus', '.entry-input', function() {
        isInteracting = true;
    });

    // 當輸入框失去焦點時，設置 isInteracting 為 false
    $(document).on('blur', '.entry-input', function() {
        isInteracting = false;
    });





    // // 接收計時結束的訊息
    // socket.on('monitor_timeout', function(data) {
    //     console.log('收到後端計時結束消息:', data.message);
    //     let continueMonitoring = confirm(data.message);
    //     if (continueMonitoring) {
    //         // 如果用戶選擇繼續監控，重新發送監控請求給後端
    //         socket.emit('monitor');
    //     } else {
    //         // 如果用戶選擇停止監控，停止所有的監控並移除 checkbox
    //         stopMonitor();
    //     }
    // });

    function stopMonitor() {
        // 將所有複選框設置為未選中狀態，並觸發變化事件
        $('.monitor-checkbox').prop('checked', false).trigger('change');
        monitoredTags.clear();// 清除所有已監控的標籤
        isCheckboxAdded = false;
        $('table tbody tr td:first-child').remove(); // 移除 checkbox 列
        updateTable(); // 再次渲染表格，反映變化

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
            $('#monitor-btn').click(); // 重啟監控
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
            }, 100);  // 根據需要調整延遲
        }
    }

    // 處理 MQTT 訊息
    socket.on('mqtt_message', function(messages) {
        messages.forEach(function(data) {
            // console.log('Received MQTT message:', data);
            var tag = data.Tag;
            if (!currentData[tag]) {
                currentData[tag] = {};
            }
            // 如果標籤未被監控，更新其值
            if (!monitoredTags.has(tag)) {
                currentData[tag].value = data.Value;
            }
            currentData[tag].sourcetime = data.SourceTime;
            currentData[tag].status = data.Quality;
            currentData[tag].IECPath = data.IECPath;
            currentData[tag].OpcuaNode = tag;
            // 保留輸入值
            currentData[tag].inputValue = currentData[tag].inputValue || '';
        });
        scheduleTableUpdate();
    });

    // 獲取樹形結構數據
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
            node.nodeId = nodeIdCounter;  // 為每個節點分配唯一的 nodeId
            map[node.nodeId] = node;  // 將 nodeId 作為數字存儲
            nodeIdCounter++;
            if (node.nodes) {
                buildNodeIdMap(node.nodes, map);  // 遞歸處理子節點
            }
        });
    }

    // 構建樹形視圖
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
                    monitoredTags.clear(); // 清除已監控的標籤
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

    // 更新表格
    function updateTable() {
        console.log('Updating table with current data:', currentData);
        var tableHtml = '';
        for (var tag in currentData) {
            var item = currentData[tag];
            tableHtml += '<tr>';
            if (isCheckboxAdded) {
                tableHtml += '<td><input type="checkbox" class="monitor-checkbox" data-tag="' + tag + '"' + (monitoredTags.has(tag) ? ' checked' : '') + '></td>';
            }
            tableHtml += '<td>' + item.OpcuaNode + '</td>';
            tableHtml += '<td>' + (item.value || '') + '</td>';
            tableHtml += '<td>' + (item.sourcetime || '') + '</td>';
            tableHtml += '<td>' + (item.status || '') + '</td>';
            tableHtml += '<td>' + item.IECPath + '</td>';

            // 如果該 Tag 被勾選監控，則顯示輸入欄位和按鈕
            if (monitoredTags.has(tag)) {
                tableHtml += '<td>';
                tableHtml += '<div class="input-group">';
                tableHtml += '<input type="text" class="form-control entry-input" placeholder="輸入值" data-tag="' + tag + '" value="' + (item.inputValue || '') + '">';
                tableHtml += '<button class="btn btn-success ok-btn col-4" data-tag="' + tag + '">OK</button>';
                tableHtml += '</div>';
                tableHtml += '</td>';
            }

            tableHtml += '</tr>';
        }
        $('#data-table').html(tableHtml);
    }
});
