from flask import Flask, render_template, redirect, url_for, request, jsonify
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_socketio import SocketIO, emit
import json
import pandas as pd
import paho.mqtt.client as mqtt
import threading
import time
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

app.secret_key = 'your_secret_key'

login_manager = LoginManager()
login_manager.init_app(app)

socketio = SocketIO(app)

with open('users.json') as f:
    users = json.load(f)['users']

mapping_df = pd.read_csv('mapping.csv')
mapping_data = mapping_df.to_dict('records')

class User(UserMixin):
    def __init__(self, id):
        self.id = id

@login_manager.user_loader
def load_user(user_id):
    return User(user_id)


mqtt_client = mqtt.Client()
def on_connect(client, userdata, flags, rc):
    print("MQTT Connected with result code " + str(rc))
    client.subscribe("#")  # 订阅所有主题
apple_temp = []
def on_message(client, userdata, msg):
    global apple_temp
    # socketio.emit('test_event',{'note':"Q??"})
    payload = msg.payload.decode()
    try:
        mqtt_data = json.loads(payload).get('Content')
        iecPath = mqtt_data.get('IECPath')
        sourcetime = mqtt_data.get('SourceTime')
        status = mqtt_data.get('Quality')
        value = mqtt_data.get('Value')
        # send mqtt data to JS
        for item in mapping_data:
            if item['IECPath'] == iecPath:
                apple_temp = {'Tag':item['OpcuaNode'],'IECPath': iecPath,'Value':value, 'SourceTime': sourcetime, 'Quality': f'Good[{status}]'}
                    
                break
        print(apple_temp)
        # websocket to JS 
        # socketio.emit('mqtt_message', {'iecpath': iecPath, 'sourcetime': sourcetime, 'status': status})
        time.sleep(1)  
    except Exception as e:
        print("Error processing MQTT message:", e)

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

def mqtt_loop():
    mqtt_client.connect('127.0.0.1', 1883, 60)
    mqtt_client.loop_forever()


mqtt_thread = threading.Thread(target=mqtt_loop)
mqtt_thread.daemon = True
mqtt_thread.start()

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
    return jsonify(tree)



import eventlet
def send_periodic_messages():
    while True:
        # 模擬資料
        socketio.emit('mqtt_message', apple_temp)
        eventlet.sleep(0.01)  

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    socketio.start_background_task(target=send_periodic_messages)


if __name__ == '__main__':
    socketio.run(app, debug=False)