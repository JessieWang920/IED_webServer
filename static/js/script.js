$(document).ready(function() {
    var socket = io.connect('http://' + document.domain + ':' + location.port);
    var currentData = {};
    var allData = {};
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

    // mqtt processing
    socket.on('mqtt_message', function(data) {

        var tag = data.Tag;
        var sourcetime = data.SourceTime;
        var status = data.Quality;
        var value = data.Value;

        // console.log('Received MQTT message:', data);

        // 更新当前数据
        if (currentData[tag]) {
            currentData[tag]['sourcetime'] = sourcetime;
            currentData[tag]['status'] = status;
            currentData[tag]['value'] = value;
        }
        
        
        // // all data
        // console.log("allData has data : ",Object.keys(allData).length);
        // allData[tag]=data
        
        // if (Object.keys(allData).length === 0) {
        //     console.log("allData is empty");        
        // }else {
        //     console.log("allData has data : ",Object.keys(allData).length);
        //     allData[tag]=data
        //     console.log('Updated current data:', );
        // }
        // console.log('CURRENT TAG',currentData[tag])
        // 更新表格
        updateTable();
    });

    // 获取树形结构数据
    $.getJSON('/tree_data', function(treeData) {
        buildTreeView(treeData);
    });

    // 构建树形视图
    function buildTreeView(treeData) {
        var treeHtml = '<ul class="list-group">';
        for (var ied in treeData) {
            treeHtml += '<li class="list-group-item">' + ied;
            treeHtml += '<ul class="list-group">';
            for (var type in treeData[ied]) {
                treeHtml += '<li class="list-group-item type-item" data-ied="' + ied + '" data-type="' + type + '">' + type + '</li>';
            }
            treeHtml += '</ul></li>';
        }
        treeHtml += '</ul>';
        $('#tree-view').html(treeHtml);

        // 绑定点击事件
        $('.type-item').click(function() {
            // console.log('data', $(this).data());
            var ied = $(this).data('ied');
            var type = $(this).data('type');
            var items = treeData[ied][type];
            
            // console.log('Selected IED:', ied);
            // console.log('Selected type:', type);
            // console.log('Selected items:', items);
            // console.log('Current data:', currentData);

            // get all tags of selected items
            // let tags = Object.values(items).map(item => item.tag);
            // console.log(tags);
            // 更新当前数据
            currentData = {};
            items.forEach(function(item) {                
                currentData[item.tag] = item;
                // console.log('item:', currentData[item.tag]);
            });
            // console.log('111Current data:', currentData);

            // 更新表格
            updateTable();
        });
    }

    // 更新表格
    function updateTable() {
        // console.log('Updating table with  data:', data);
        // console.log('Updating table with current data:', currentData);
        var tableHtml = '';
        for (var tag in currentData) {
            // console.log('Processing tag:', tag);
            // console.log('alldata [tag]', allData[tag] )
            var item = currentData[tag];
            // console.log('item:', item);
            tableHtml += '<tr>';
            tableHtml += '<td>' + item.IecPath + '</td>';
            tableHtml += '<td>' + (item.value || '') + '</td>';
            tableHtml += '<td>' + (item.sourcetime || '') + '</td>';
            tableHtml += '<td>' + (item.status || '') + '</td>';
            tableHtml += '<td>' + item.tag + '</td>';
            tableHtml += '</tr>';
        }
        // console.log('Table HTML:', tableHtml);
        $('#data-table').html(tableHtml);
        // console.log('Table updated successfully');
    }
});
