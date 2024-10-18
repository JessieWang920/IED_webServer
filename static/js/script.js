$(document).ready(function() {
    var socket = io.connect('http://' + document.domain + ':' + location.port);
    var currentData = {};

    // 更新 WebSocket 连接状态
    socket.on('connect', function() {
        $('#status-indicator').removeClass('status-red').addClass('status-green');
    });

    socket.on('disconnect', function() {
        $('#status-indicator').removeClass('status-green').addClass('status-red');
    });

    // 处理接收到的 MQTT 消息
    socket.on('mqtt_message', function(data) {
        var tag = data.tag;
        var sourcetime = data.sourcetime;
        var status = data.status;

        // 更新当前数据
        if (currentData[tag]) {
            currentData[tag]['sourcetime'] = sourcetime;
            currentData[tag]['status'] = status;
        }

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
            var ied = $(this).data('ied');
            var type = $(this).data('type');
            var items = treeData[ied][type];

            // 更新当前数据
            currentData = {};
            items.forEach(function(item) {
                currentData[item.tag] = item;
            });

            // 更新表格
            updateTable();
        });
    }

    // 更新表格
    function updateTable() {
        var tableHtml = '';
        for (var tag in currentData) {
            var item = currentData[tag];
            tableHtml += '<tr>';
            tableHtml += '<td>' + item.IecPath + '</td>';
            tableHtml += '<td>' + (item.sourcetime || '') + '</td>';
            tableHtml += '<td>' + (item.status || '') + '</td>';
            tableHtml += '</tr>';
        }
        $('#data-table').html(tableHtml);
    }
});
