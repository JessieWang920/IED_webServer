$(document).ready(function() {
    var socket = io.connect('http://' + document.domain + ':' + location.port);
    var currentData = {};

    socket.on('connect', function() {
        console.log('WebSocket connected successfully.');
        $('#status-indicator').removeClass('status-red').addClass('status-green');
    });

    socket.on('disconnect', function() {
        console.error('WebSocket disconnected.');
        $('#status-indicator').removeClass('status-green').addClass('status-red');
    });
    // for test
    // socket.on('test_event',function(data1){
    //     console.log(data1)    
    // })


    var updateScheduled = false;
    function scheduleTableUpdate() {
        if (!updateScheduled) {
            updateScheduled = true;
            setTimeout(function() {
                updateTable();
                updateScheduled = false;
            }, 100);  // 根据需要调整延迟
        }
    }


    // mqtt processing
    socket.on('mqtt_message', function(messages) {

        // var tag = data.Tag;
        // var sourcetime = data.SourceTime;
        // var status = data.Quality;
        // var value = data.Value;
        // console.log('Received MQTT message:', data);
        // // 更新当前数据
        // // console.log('1Current data:', currentData);
        // console.log('1currentData has tag:',currentData[tag]);
        // if (currentData[tag]) {
        //     console.log('currentData has tag:', currentData[tag]);

        //     currentData[tag]['sourcetime'] = sourcetime;
        //     currentData[tag]['status'] = status;
        //     currentData[tag]['value'] = value;
        // }       
        console.log('Received MQTT message:', messages);
        messages.forEach(function(data) {
            // console.log('Received MQTT message:', data);
            var tag = data.Tag;
            currentData[tag] = {
                sourcetime: data.SourceTime,
                status: data.Quality,
                value: data.Value,
                IECPath: data.IECPath,
                OpcuaNode: data.OpcuaNode
            };
        });
        scheduleTableUpdate();

        
        // 更新表格
        // updateTable();
    });

    // 获取树形结构数据
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
            node.nodeId = nodeIdCounter;  // 为每个节点分配唯一的 nodeId
            map[node.nodeId] = node;  // 将 nodeId 作为数字存储
            nodeIdCounter++;
            if (node.nodes) {
                
                buildNodeIdMap(node.nodes, map);  // 递归处理子节点
            }
        });
    }

    
    // 构建树形视图
    function buildTreeView(treeData,treeData2Js) {
        var nodeIdMap = {};
        buildNodeIdMap(treeData2Js, nodeIdMap);
        // console.log('nodeIdMap:', nodeIdMap);
        if (treeData2Js) {
            $('#treeview1').treeview({
                data: treeData2Js,
                collapseIcon:'fas fa-solid fa-caret-down',
                expandIcon:'fas fa-solid fa-caret-right',
                onNodeSelected: function(event, data) {
                    var parentNodeId = data.parentId;
                    var ied ;
                    // get parent node information
                    if (parentNodeId != null) {
                        ied = nodeIdMap[parentNodeId+1].text;
                        var type = data.text;  
                        var items = treeData[ied][type];
                        // console.log('Selected IED:', ied);
                        // console.log('Selected type:', type);
                        console.log('Selected items:', items);
                        var topic = 'Topic/' + type + '/' + ied;
                        socket.emit('subscribe', { topic: topic });
                        // 加這個功能幹
                        console.log('Subscriber:Topic/'+type+'/'+ied);
                    } else {
                        ied = data.text;
                        console.log('Selected IED:', ied);
                        return;
                    }
                    

                    currentData = {};
                    items.forEach(function(item) {                
                        currentData[item.OpcuaNode] = item;
                    });
                    // console.log('Current data:', currentData);

                    updateTable();


                }
            });
        } else {
            console.error("Failed to load tree data");
        }

        // $('.type-item').click(function() {
        //     console.log('data', $(this).data());
        //     alert('Selected type:'+ $(this).data('type'));
        //     var ied = $(this).data('ied');
        //     var type = $(this).data('type');
        //     // get all tags of selected items
        //     // let tags = Object.values(items).map(item => item.tag);
        //     // console.log(tags);
        //     // 更新当前数据
        //     currentData = {};
        //     items.forEach(function(item) {                
        //         currentData[item.tag] = item;
        //         // console.log('item:', currentData[item.tag]);
        //     });
        //     // console.log('111Current data:', currentData);

        //     // 更新表格
        //     updateTable();
        // });
    }

    // 更新表格
    function updateTable() {
        // console.log('Updating table with  data:', data);
        console.log('Updating table with current data:', currentData);
        var tableHtml = '';
        for (var tag in currentData) {
            // console.log('Processing tag:', tag);
            // console.log('alldata [tag]', allData[tag] )
            var item = currentData[tag];
            // console.log('item:', item);
            tableHtml += '<tr>';
            tableHtml += '<td>' + item.IECPath + '</td>';
            tableHtml += '<td>' + (item.value || '') + '</td>';
            tableHtml += '<td>' + (item.sourcetime || '') + '</td>';
            tableHtml += '<td>' + (item.status || '') + '</td>';
            tableHtml += '<td>' + item.OpcuaNode + '</td>';
            tableHtml += '</tr>';
        }
        console.log('Table HTML:', tableHtml);
        $('#data-table').html(tableHtml);
        // console.log('Table updated successfully');
    }
});
