from flask import Flask, render_template, redirect, url_for, request, jsonify
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_socketio import SocketIO, emit, disconnect
import json
import pandas as pd
import paho.mqtt.client as mqtt
import threading
import time
from flask_cors import CORS
from threading import Lock
from collections import defaultdict
import eventlet
import re


# init lock and data structure
message_buffer = defaultdict(list)
message_buffer_lock = Lock()
client_subscriptions = {}
client_subscriptions_lock = Lock()
last_topics = {}
last_message_cache = defaultdict(dict)

clients_monitored_tags = {}
clients_monitored_tags_lock = Lock()


app = Flask(__name__)
app.secret_key = 'your_secret_key'
CORS(app)

login_manager = LoginManager()
login_manager.init_app(app)
# if user is not logged in, redirect to login page
login_manager.login_view = 'login'

# socketio = SocketIO(app)
socketio = SocketIO(app, async_mode='eventlet', ping_interval=25, ping_timeout=120)

with open(r"D:\project\IED\webServer_mqtt2web\config\users.json") as f:
    users = json.load(f)['users']

mapping_df = pd.read_csv(r"D:\project\IED\mqtt2opcua_part2\config\iec2opcua_mapping.csv")
mapping_data = mapping_df.to_dict('records')

class User(UserMixin):
    def __init__(self, id,username, password):
        self.id = id
        self.username = username
        self.password = password

@login_manager.user_loader
def load_user(user_id):
    """
    在每次請求時，將會呼叫此函式，即可得知哪位使用者。
    """    
    for user in users:
        if user['id'] == user_id:
            return User(user_id,user['username'],user['password'])
    return None

full_subscription_client = mqtt.Client()

def on_full_message(client, userdata, msg):
    global last_message_cache
    payload = msg.payload.decode()
    try:
        mqtt_data = json.loads(payload).get('Content')
        iecPath = mqtt_data.get('IECPath')
        sourcetime = mqtt_data.get('SourceTime')
        status = mqtt_data.get('Quality')
        value = mqtt_data.get('Value')

        # 保存每个 `Topic` 最新的数据
        for item in mapping_data:
            if item['IECPath'] == iecPath:
                tag = item['OpcuaNode']
                message = {
                    'Tag': tag,
                    'IECPath': iecPath,
                    'Value': value,
                    'SourceTime': sourcetime,
                    'Quality': f'Good[{status}]',
                    'topic': msg.topic
                }
                # 更新缓存，确保每个 `Topic` 的最新值可用
                last_message_cache[msg.topic][tag] = message

                break
    except Exception as e:
        print("FULL 处理MQTT消息时出错：", e)

# 配置独立客户端
full_subscription_client.on_message = on_full_message


mqtt_client = mqtt.Client()


def on_connect(client, userdata, flags, rc):
    print("MQTT Connected with result code " + str(rc))
    # client.subscribe("#")  

# apple_temp = []
# def on_message(client, userdata, msg):
#     global apple_temp
#     payload = msg.payload.decode()
#     try:
#         mqtt_data = json.loads(payload).get('Content')
#         iecPath = mqtt_data.get('IECPath')
#         sourcetime = mqtt_data.get('SourceTime')
#         status = mqtt_data.get('Quality')
#         value = mqtt_data.get('Value')
#         # send mqtt data to JS
#         for item in mapping_data:
#             if item['IECPath'] == iecPath:
#                 apple_temp = {'Tag':item['OpcuaNode'],'IECPath': iecPath,'Value':value, 'SourceTime': sourcetime, 'Quality': f'Good[{status}]'}
                    
#                 break
#         print(apple_temp)
#         # websocket to JS 
#         # socketio.emit('mqtt_message', {'iecpath': iecPath, 'sourcetime': sourcetime, 'status': status})
#         # time.sleep(2)  
#     except Exception as e:
#         print("Error processing MQTT message:", e)

def on_message(client, userdata, msg):
    global message_buffer
    payload = msg.payload.decode()
    try:
        mqtt_data = json.loads(payload).get('Content')
        iecPath = mqtt_data.get('IECPath')
        sourcetime = mqtt_data.get('SourceTime')
        status = mqtt_data.get('Quality')
        value = mqtt_data.get('Value')
        for item in mapping_data:
            if item['IECPath'] == iecPath:
                message = {
                    'Tag': item['OpcuaNode'],
                    'IECPath': iecPath,
                    'Value': value,
                    'SourceTime': sourcetime,
                    'Quality': f'Good[{status}]',
                    'topic': msg.topic
                }
                with message_buffer_lock:
                    message_buffer[msg.topic].append(message)
                break
    except Exception as e:
        print("处理MQTT消息时出错：", e)

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def mqtt_loop():
    mqtt_client.connect('127.0.0.1', 1883, 60)
    mqtt_client.loop_forever()

def full_subscription_mqtt_loop():
    full_subscription_client.connect('127.0.0.1', 1883, 60)
    full_subscription_client.subscribe('Topic/#') 
    full_subscription_client.loop_forever()

# 启动用于单个客户端订阅的线程
mqtt_thread = threading.Thread(target=mqtt_loop)
mqtt_thread.daemon = True
mqtt_thread.start()

# 启动用于全局订阅所有Topic的线程
full_subscription_thread = threading.Thread(target=full_subscription_mqtt_loop)
full_subscription_thread.daemon = True
full_subscription_thread.start()

@app.route('/', methods=['GET'])
def root():
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        user = next((u for u in users if u['username'] == username and u['password'] == password), None)
        if user:
        # for user in users:
        #     if user['username'] == username and user['password'] == password:
            user_obj = User(user['id'], username, password)
            login_user(user_obj)
            return redirect(url_for('index'))
        return render_template('login.html', error='帳密錯誤')
    return render_template('login.html')

@app.route('/index')
@login_required
def index():
    return render_template('index.html', mapping_data=mapping_data)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))


def convert_to_js_format(tree):
    js_format = []
    parent_counter = 1
    # parent_id_map = {}  # 紀錄父節點的 id

    for ied, types in tree.items():
        parent_node_id = f'parent-{parent_counter}'
        parent_node = {
            'text': f'{ied}',
            'href': f'#{ied}',
            'tags': [str(len(types))],
            'nodes': [],
            'nodeId': parent_node_id,  # 添加唯一的 parentId
            'parentId': None  # 根节点的父节点为 None
        }
        child_counter = 1

        for type, nodes in types.items():
            child_node_id = f'child-{parent_counter}-{child_counter}'
            child_node = {
                'text': f'{type}',
                'href': f'#{type}',
                'tags': [str(len(nodes))],
                # 'nodes': [],
                'nodeId': child_node_id,  # 子节点的唯一 ID
                'parentId': parent_node_id  # 子节点的 parentId 为父节点的 nodeId
            }
            # grandchild_counter = 1
            # for opcua_node in nodes:
            #     grandchild_node_id = f'grandchild-{parent_counter}-{child_counter}-{grandchild_counter}'
            #     grandchild_node = {
            #         'text': f'{opcua_node}',
            #         'href': f'#{opcua_node}',
            #         'tags': ['0'],
            #         'nodeId': grandchild_node_id,  # 孙节点的唯一 ID
            #         'parentId': child_node_id  # 孙节点的 parentId 为子节点的 nodeId
            #     }
            #     child_node['nodes'].append(grandchild_node)
            #     grandchild_counter += 1
            parent_node['nodes'].append(child_node)
            child_counter += 1

        js_format.append(parent_node)
        parent_counter += 1

    return js_format


@app.route('/tree_data')
@login_required
def tree_data():
    tree = {}
    for item in mapping_data:
        ied = item['IEDName']
        type_ = item['Type']
        if ied not in tree:
            tree[ied] = {}
        if type_ not in tree[ied]:
            tree[ied][type_] = []
        tree[ied][type_].append(item)

    js_format = convert_to_js_format(tree)
    return jsonify({'treeData': tree, 'treeJsFormat': js_format})

def send_periodic_messages():
    while True:
        with message_buffer_lock:
            if message_buffer:
                buffer_copy = message_buffer.copy()
                message_buffer.clear()
            else:
                buffer_copy = {}
        with client_subscriptions_lock:
            subscriptions_copy = client_subscriptions.copy()
        # 向订阅的客户端发送消息
        for sid, topics in subscriptions_copy.items():
            client_messages = []
            for topic in topics:
                if topic in buffer_copy:
                    client_messages.extend(buffer_copy[topic])
                elif '+' in topic:
                    # parent node
                    if (buffer_copy):
                        for child_node_topic  in buffer_copy:
                            client_messages.extend(buffer_copy[child_node_topic])
                elif '#' in topic:
                    if (buffer_copy):
                        for child_node_topic  in buffer_copy:
                            client_messages.extend(buffer_copy[child_node_topic])
            if client_messages:
                socketio.emit('mqtt_message', client_messages, room=sid)
        eventlet.sleep(0.5)  # 根据需要调整时间间隔


import eventlet
# def send_periodic_messages():
#     while True:
#         # 模擬資料
#         socketio.emit('mqtt_message', apple_temp)
#         eventlet.sleep(1)  

# @socketio.on('connect')
# def handle_connect():
#     print('Client connected')
#     socketio.start_background_task(target=send_periodic_messages)



pending_data = []

@socketio.on('add_to_pending')
def add_to_pending(data):
    pending_data.append(data)
    print('get暫存資料:', data)

def send_pending_data():
    for data in pending_data:
        # 這裡可以實現將資料發送至指定位置
        print('發送暫存資料:', data)
    pending_data.clear()


# @socketio.on('monitor')
# def start_monitor():
#     def monitor_timer():
#         eventlet.sleep(10)  # 5 分鐘
#         socketio.emit('monitor_timeout', {'message': 'monitor 是否繼續?'})

#     # threading.Thread(target=monitor_timer).start()
#     socketio.start_background_task(monitor_timer)


@socketio.on('connect')
def handle_connect():
    print('Client connected:', request.sid)
    with client_subscriptions_lock:
        client_subscriptions[request.sid] = set()
    with clients_monitored_tags_lock:
        clients_monitored_tags[request.sid] = set()

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected:', request.sid)
    with client_subscriptions_lock:
        client_subscriptions.pop(request.sid, None)

    with clients_monitored_tags_lock:
        monitored_tags = clients_monitored_tags.pop(request.sid, None)
        if monitored_tags:
            for tag in monitored_tags:
                print(f"Stopping monitoring tag: {tag} for client {request.sid}")
                # 執行清理邏輯，例如發送停止監控指令
                tag_control({'tag': tag, 'control': False})

    print(f"Client {request.sid} disconnected")

@socketio.on('update_monitored_tags')
def update_monitored_tags(data):
    # 更新客戶端的 monitoredTags 集合
    client_sid = request.sid
    tags = data.get('tags', [])
    with clients_monitored_tags_lock:
        clients_monitored_tags[client_sid] = set(tags)
    print(f"Updated monitored tags for client {client_sid}: {tags}")


@socketio.on('subscribe')
def handle_subscribe(data):
    topic = data.get('topic')
    # print(topic)
    sid = request.sid
    with client_subscriptions_lock:
        if sid not in client_subscriptions:
            client_subscriptions[sid] = set()
        # 複製訂閱主題
        last_topics[sid] = client_subscriptions[sid].copy()
        # 取消之前訂閱
        if last_topics[sid]:
            topics_to_unsubscribe = list(last_topics[sid])
            mqtt_client.unsubscribe(topics_to_unsubscribe)
            # print(f"取消訂閱: {topics_to_unsubscribe}")
            # 清空之前的訂閱
            client_subscriptions[sid].clear()
        # 加新的訂閱 
        client_subscriptions[sid].add(topic)

    # 可选地，在此处管理MQTT订阅
    mqtt_client.subscribe(topic,qos=1)    
    # 發舊資料
    combined_list = []
    if topic in last_message_cache:
        for i in last_message_cache[topic]:
            combined_list.append(last_message_cache[topic][i]) 
        socketio.emit('mqtt_message', combined_list, room=sid)
    elif '+' in topic:
        pattern = re.compile(topic.replace('+', '[^/]+'))
        for topic, tags in last_message_cache.items():
            if pattern.match(topic):
                for _, tag_value in tags.items():
                    # 如果匹配到，将其加入到结果中
                    combined_list.append(tag_value)
        socketio.emit('mqtt_message', combined_list, room=sid)
    elif '#' in topic:
        for topic, tags in last_message_cache.items():
            for _, tag_value in tags.items():
                combined_list.append(tag_value)
        socketio.emit('mqtt_message', combined_list, room=sid)

    socketio.start_background_task(target=send_periodic_messages)


@socketio.on('connect', namespace='/index')
def handle_connect(auth):
    username = auth.get('username')
    password = auth.get('password')
    if username == 'a' and password == 'ss':
        print(f"{username} 已成功連接")
    else:
        print("認證失敗")
        disconnect()


@socketio.on('tag_control')
def tag_control(data):
    print(data)
    tag = data.get('tag')
    control = data.get('control')

    # 通過 SocketIO 通知 OPC UA Server 將數據寫入
    socketio.emit('control_tag', {'tag': tag, 'control': control})

    if not control:
        sid = request.sid
        for topic, tags in last_message_cache.items():
            if tag in tags:                
                value = last_message_cache[topic][tag]['Value']
                socketio.emit('mqtt_message', [last_message_cache[topic][tag]], room=sid)
                # 給 OPCUA
                socketio.emit('tag_value_updata', {'tag': tag, 'value': value})
                break




@socketio.on('set_tag_value')
def set_tag_value(data):
    print(data)
    tag = data.get('tag')
    value = data.get('value')

    # 通過 SocketIO 通知 OPC UA Server 將數據寫入
    socketio.emit('tag_value_updata', {'tag': tag, 'value': value})


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', debug=False)