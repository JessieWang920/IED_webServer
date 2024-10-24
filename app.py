from flask import Flask, render_template, redirect, url_for, request, jsonify
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_socketio import SocketIO, emit
import json
import pandas as pd
import paho.mqtt.client as mqtt
import threading
import time
from flask_cors import CORS

from threading import Lock
from collections import defaultdict

# 初始化锁和数据结构
message_buffer = defaultdict(list)
message_buffer_lock = Lock()
client_subscriptions = {}
client_subscriptions_lock = Lock()



app = Flask(__name__)
CORS(app)

app.secret_key = 'your_secret_key'

login_manager = LoginManager()
login_manager.init_app(app)
# if user is not logged in, redirect to login page
login_manager.login_view = 'login'

socketio = SocketIO(app)

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


mqtt_client = mqtt.Client()

def on_connect(client, userdata, flags, rc):
    print("MQTT Connected with result code " + str(rc))
    client.subscribe("#")  

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
        # 处理MQTT数据
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


mqtt_thread = threading.Thread(target=mqtt_loop)
mqtt_thread.daemon = True
mqtt_thread.start()

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

@socketio.on('connect')
def handle_connect():
    print('客户端已连接', request.sid)
    
    with client_subscriptions_lock:
        client_subscriptions[request.sid] = set()

@socketio.on('disconnect')
def handle_disconnect():
    print('客户端已断开', request.sid)
    with client_subscriptions_lock:
        client_subscriptions.pop(request.sid, None)

@socketio.on('subscribe')
def handle_subscribe(data):
    topic = data.get('topic')
    print(topic)
    sid = request.sid
    with client_subscriptions_lock:
        if sid not in client_subscriptions:
            client_subscriptions[sid] = set()
        client_subscriptions[sid].add(topic)
    # 可选地，在此处管理MQTT订阅
    mqtt_client.subscribe(topic,qos=1)
    socketio.start_background_task(target=send_periodic_messages)


if __name__ == '__main__':
    
    socketio.run(app, debug=True)