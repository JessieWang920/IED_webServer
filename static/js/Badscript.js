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

    // 获取树形结构数据
    $.getJSON('/tree_data', function(treeData) {
        buildTreeView(treeData);
    });

    // 构建树形视图
    function buildTreeView(treeData) {
        var treeViewData = [];
        
        // 将原始 treeData 转换为符合 dxTreeView 的格式
        for (var ied in treeData) {
            var parentNode = {
                id: ied,
                text: ied,
                expanded: true,
                items: []
            };
            for (var type in treeData[ied]) {
                parentNode.items.push({
                    id: ied + '-' + type,
                    text: type,
                    data: treeData[ied][type] // 保留原始数据供后续使用
                });
            }
            treeViewData.push(parentNode);
        }

        // 初始化 dxTreeView
        $("#tree-view").dxTreeView({
            items: treeViewData,
            dataStructure: "tree",
            keyExpr: "id",
            displayExpr: "text",
            parentIdExpr: "parentId",
            onItemClick: function(e) {
                var itemData = e.itemData.data;

                if (itemData) {
                    // 点击类型节点后更新当前数据
                    currentData = {};
                    itemData.forEach(function(item) {
                        currentData[item.tag] = item;
                    });

                    // 更新表格
                    updateTable();
                }
            }
        });
    }

    // 更新表格
    function updateTable() {
        var tableHtml = '';
        for (var tag in currentData) {
            var item = currentData[tag];
            tableHtml += '<tr>';
            tableHtml += '<td>' + item.IecPath + '</td>';
            tableHtml += '<td>' + (item.value || '') + '</td>';
            tableHtml += '<td>' + (item.sourcetime || '') + '</td>';
            tableHtml += '<td>' + (item.status || '') + '</td>';
            tableHtml += '<td>' + item.tag + '</td>';
            tableHtml += '</tr>';
        }
        $('#data-table').html(tableHtml);
    }
});
