from flask import Flask, render_template, redirect, url_for, request, jsonify
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_socketio import SocketIO, emit
import json
import pandas as pd
import paho.mqtt.client as mqtt
import threading

app = Flask(__name__)
app.secret_key = 'your_secret_key'

login_manager = LoginManager()
login_manager.init_app(app)

socketio = SocketIO(app)
# socketio = SocketIO(app, cors_allowed_origins="*")

# 读取用户数据
with open('users.json') as f:
    users = json.load(f)['users']

# 读取映射数据
mapping_df = pd.read_csv('mapping.csv')

# 将映射数据转换为字典列表
mapping_data = mapping_df.to_dict('records')

# 用户类
class User(UserMixin):
    def __init__(self, id):
        self.id = id

# 用户加载回调
@login_manager.user_loader
def load_user(user_id):
    return User(user_id)

# MQTT 客户端设置
mqtt_client = mqtt.Client()

def on_connect(client, userdata, flags, rc):
    print("MQTT Connected with result code " + str(rc))
    client.subscribe("Topic/#")  # 订阅所有主题

def on_message(client, userdata, msg):
    payload = msg.payload.decode()
    try:
        mqtt_data = json.loads(payload)["Content"]
        iec_path = mqtt_data.get('IECPath')
        sourcetime = mqtt_data.get('SourceTime')
        status = mqtt_data.get('Quality')

        print({'IECPath': iec_path, 'sourcetime': sourcetime, 'status': status})
        # 通过 WebSocket 发送数据给前端
        socketio.emit('mqtt_message', {'IECPath': iec_path, 'sourcetime': sourcetime, 'status': status})
    except Exception as e:
        print("Error processing MQTT message:", e)

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def mqtt_loop():
    mqtt_client.connect('127.0.0.1', 1883, 60)
    mqtt_client.loop_forever()

# 启动 MQTT 客户端线程
mqtt_thread = threading.Thread(target=mqtt_loop)
mqtt_thread.daemon = True
mqtt_thread.start()

# 路由和视图函数
@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        for user in users:
            if user['username'] == username and user['password'] == password:
                user_obj = User(username)
                login_user(user_obj)
                return redirect(url_for('index'))
        return render_template('login.html', error='用户名或密码错误')
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

# 获取树形结构数据的接口
@app.route('/tree_data')
@login_required
def tree_data():
    tree = {}
    for item in mapping_data:
        ied = item['IED']
        type_ = item['Type']
        if ied not in tree:
            tree[ied] = {}
        if type_ not in tree[ied]:
            tree[ied][type_] = []
        tree[ied][type_].append(item)
    return jsonify(tree)

@socketio.on('connect')
def handle_connect():
    print('Client connected')

if __name__ == '__main__':
    socketio.run(app, debug=True)
