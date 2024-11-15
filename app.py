import logging
import os
import platform
import json
import re
import threading
import time
from collections import defaultdict
from threading import Lock

import eventlet
import pandas as pd
import paho.mqtt.client as mqtt
from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_cors import CORS
from flask_login import (
    LoginManager,
    UserMixin,
    login_required,
    login_user,
    logout_user,
)
from flask_socketio import SocketIO, emit, disconnect

# Determine system paths based on OS
LINUX = platform.system() == "Linux"
if LINUX:
    PATH = os.path.expanduser("~/Project/IED_webServer")
    OPCUA_PATH = os.path.expanduser("~/Project/IED_server")
    MQTT_BROKER = "0.0.0.0"
else:
    PATH = r"D:\project\IED\webServer_mqtt2web"
    OPCUA_PATH = r"D:\project\IED\mqtt2opcua_part2"
    MQTT_BROKER = "127.0.0.1"

CSV_FILE_PATH = os.path.join(OPCUA_PATH, "config", "iec2opcua_mapping.csv")
ACCOUNT_FILE_PATH = os.path.join(PATH, "config", "users.json")
LOG_FILE_PATH = os.path.join(PATH, "log", "webServer.log")

# Set up logging
logging.basicConfig(
    level=logging.ERROR,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(LOG_FILE_PATH, mode="a"), logging.StreamHandler()],
)
logger = logging.getLogger("web_server")
logger.error("========================================================")

# Initialize locks and data structures
message_buffer = defaultdict(list)
message_buffer_lock = Lock()
client_subscriptions = {}
client_subscriptions_lock = Lock()
last_topics = {}
last_message_cache = defaultdict(dict)
clients_monitored_tags = {}
clients_monitored_tags_lock = Lock()

# Initialize Flask app
app = Flask(__name__)
app.secret_key = "your_secret_key"
CORS(app)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login" # if user is not logged in, redirect to login page

socketio = SocketIO(app, async_mode="eventlet", ping_interval=25, ping_timeout=120)

# Load users from JSON file
try:
    with open(ACCOUNT_FILE_PATH) as f:
        users = json.load(f)["users"]
except FileNotFoundError:
    logger.error("Account file not found.")
    users = []
except Exception as e:
    logger.error(f"Error loading account file: {e}")
    users = []

# Load mapping data from CSV
try:
    mapping_df = pd.read_csv(CSV_FILE_PATH)
    mapping_data = mapping_df.to_dict("records")
except Exception as e:
    logger.error(f"Error loading mapping file: {e}")
    mapping_data = []


class User(UserMixin):
    """User class for Flask-Login."""

    def __init__(self, id, username, password):
        self.id = id
        self.username = username
        self.password = password


@login_manager.user_loader
def load_user(user_id):
    """Load user from user ID."""
    for user in users:
        if user["id"] == user_id:
            return User(user_id, user["username"], user["password"])
    return None


# Initialize MQTT clients
full_subscription_client = mqtt.Client(client_id="full_subscription_client_unique_id")
mqtt_client = mqtt.Client(client_id="mqtt_client_unique_id")


def on_full_message(client, userdata, msg):
    """Callback for handling full MQTT messages."""
    global last_message_cache
    payload = msg.payload.decode()
    try:
        mqtt_data = json.loads(payload).get("Content")
        iecPath = mqtt_data.get("IECPath")
        sourcetime = mqtt_data.get("SourceTime")
        status = mqtt_data.get("Quality")
        value = mqtt_data.get("Value")

        # Save the latest data for each Topic
        for item in mapping_data:
            if item["IECPath"] == iecPath:
                tag = item["OpcuaNode"]
                message = {
                    "Tag": tag,
                    "IECPath": iecPath,
                    "Value": value,
                    "SourceTime": sourcetime,
                    "Quality": f"Good[{status}]",
                    "topic": msg.topic,
                }
                # Update cache to ensure latest value for each Topic
                last_message_cache[msg.topic][tag] = message
                break
    except Exception as e:
        logger.error(f"Error processing full MQTT message: {e}")


def on_connect(client, userdata, flags, rc):
    """Callback for MQTT client connection."""
    logger.info(f"MQTT Connected with result code {rc}")


def on_message(client, userdata, msg):
    """Callback for handling MQTT messages."""
    global message_buffer
    payload = msg.payload.decode()
    try:
        mqtt_data = json.loads(payload).get("Content")
        iecPath = mqtt_data.get("IECPath")
        sourcetime = mqtt_data.get("SourceTime")
        status = mqtt_data.get("Quality")
        value = mqtt_data.get("Value")
        for item in mapping_data:
            if item["IECPath"] == iecPath:
                message = {
                    "Tag": item["OpcuaNode"],
                    "IECPath": iecPath,
                    "Value": value,
                    "SourceTime": sourcetime,
                    "Quality": f"Good[{status}]",
                    "topic": msg.topic,
                }
                with message_buffer_lock:
                    message_buffer[msg.topic].append(message)
                break
    except Exception as e:
        logger.error(f"Error processing MQTT message: {e}")


def setup_mqtt_clients():
    """Setup MQTT clients."""
    try:
        # Setup mqtt_client
        mqtt_client.on_connect = on_connect
        mqtt_client.on_message = on_message
        mqtt_client.connect(MQTT_BROKER, 1883, 60)
        mqtt_client.loop_start()

        # Setup full_subscription_client
        full_subscription_client.on_message = on_full_message
        full_subscription_client.connect(MQTT_BROKER, 1883, 60)
        full_subscription_client.subscribe("Topic/#")
        full_subscription_client.loop_start()
    except Exception as e:
        logger.error(f"Error setting up MQTT clients: {e}")


setup_mqtt_clients()


@app.route("/", methods=["GET"])
def root():
    """Redirect to login page."""
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    """Handle user login."""
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]
        user = next(
            (
                u
                for u in users
                if u["username"] == username and u["password"] == password
            ),
            None,
        )
        if user:
            user_obj = User(user["id"], username, password)
            login_user(user_obj)
            return redirect(url_for("index"))
        return render_template("login.html", error="帳密錯誤")
    return render_template("login.html")


@app.route("/index")
@login_required
def index():
    """Render index page."""
    return render_template("index.html", mapping_data=mapping_data)


@app.route("/logout")
@login_required
def logout():
    """Handle user logout."""
    logout_user()
    return redirect(url_for("login"))


def convert_to_js_format(tree):
    """Convert tree data to JS format."""
    js_format = []
    parent_counter = 1

    for ied, types in tree.items():
        parent_node_id = f"parent-{parent_counter}"
        parent_node = {
            "text": f"{ied}",
            "href": f"#{ied}",
            "tags": [str(len(types))],
            "nodes": [],
            "nodeId": parent_node_id,
            "parentId": None,
        }
        child_counter = 1

        for type_, nodes in types.items():
            child_node_id = f"child-{parent_counter}-{child_counter}"
            child_node = {
                "text": f"{type_}",
                "href": f"#{type_}",
                "tags": [str(len(nodes))],
                "nodeId": child_node_id,
                "parentId": parent_node_id,
            }
            parent_node["nodes"].append(child_node)
            child_counter += 1

        js_format.append(parent_node)
        parent_counter += 1

    return js_format


@app.route("/tree_data")
@login_required
def tree_data():
    """Provide tree data for the frontend."""
    tree = {}
    for item in mapping_data:
        ied = item["IEDName"]
        type_ = item["Type"]
        if ied not in tree:
            tree[ied] = {}
        if type_ not in tree[ied]:
            tree[ied][type_] = []
        tree[ied][type_].append(item)

    js_format = convert_to_js_format(tree)
    return jsonify({"treeData": tree, "treeJsFormat": js_format})


def send_periodic_messages():
    """Send periodic messages to clients."""
    while True:
        try:
            with message_buffer_lock:
                if message_buffer:
                    buffer_copy = message_buffer.copy()
                    message_buffer.clear()
                else:
                    buffer_copy = {}
            with client_subscriptions_lock:
                subscriptions_copy = client_subscriptions.copy()

            for sid, topics in subscriptions_copy.items():
                client_messages = []
                for topic in topics:
                    if topic in buffer_copy:
                        client_messages.extend(buffer_copy[topic])
                    elif "+" in topic or "#" in topic:
                        # Handle wildcard topics
                        pattern = re.compile(
                            topic.replace("+", "[^/]+").replace("#", ".*")
                        )
                        for msg_topic, messages in buffer_copy.items():
                            if pattern.match(msg_topic):
                                client_messages.extend(messages)
                if client_messages:
                    socketio.emit("mqtt_message", client_messages, room=sid)
            eventlet.sleep(0.5)
        except Exception as e:
            logger.error(f"Error in send_periodic_messages: {e}")


@socketio.on("connect")
def handle_connect():
    """Handle client connection."""
    logger.info(f"Client connected: {request.sid}")
    with client_subscriptions_lock:
        client_subscriptions[request.sid] = set()
    with clients_monitored_tags_lock:
        clients_monitored_tags[request.sid] = set()


@socketio.on("disconnect")
def handle_disconnect():
    """Handle client disconnection."""
    logger.info(f"Client disconnected: {request.sid}")
    with client_subscriptions_lock:
        client_subscriptions.pop(request.sid, None)

    with clients_monitored_tags_lock:
        monitored_tags = clients_monitored_tags.pop(request.sid, None)
        if monitored_tags:
            for tag in monitored_tags:
                logger.info(
                    f"Stopping monitoring tag: {tag} for client {request.sid}"
                )
                tag_control({"tag": tag, "control": False})


@socketio.on("update_monitored_tags")
def update_monitored_tags(data):
    """Update monitored tags for a client."""
    client_sid = request.sid
    tags = data.get("tags", [])
    with clients_monitored_tags_lock:
        clients_monitored_tags[client_sid] = set(tags)
    logger.info(f"Updated monitored tags for client {client_sid}: {tags}")


@socketio.on("subscribe")
def handle_subscribe(data):
    """Handle topic subscription from client."""
    topic = data.get("topic")
    sid = request.sid
    with client_subscriptions_lock:
        if sid not in client_subscriptions:
            client_subscriptions[sid] = set()
        # Copy last subscriptions
        last_topics[sid] = client_subscriptions[sid].copy()
        # Unsubscribe previous topics
        if last_topics[sid]:
            topics_to_unsubscribe = list(last_topics[sid])
            mqtt_client.unsubscribe(topics_to_unsubscribe)
            client_subscriptions[sid].clear()
        # Add new subscription
        client_subscriptions[sid].add(topic)

    try:
        mqtt_client.subscribe(topic, qos=1)
    except Exception as e:
        logger.error(f"Error subscribing to topic {topic}: {e}")

    # Send cached messages
    combined_list = []
    if topic in last_message_cache:
        combined_list.extend(last_message_cache[topic].values())
    elif "+" in topic or "#" in topic:
        pattern = re.compile(topic.replace("+", "[^/]+").replace("#", ".*"))
        for msg_topic, tags in last_message_cache.items():
            if pattern.match(msg_topic):
                combined_list.extend(tags.values())
    if combined_list:
        socketio.emit("mqtt_message", combined_list, room=sid)

    socketio.start_background_task(target=send_periodic_messages)


@socketio.on("tag_control")
def tag_control(data):
    """Handle tag control from client."""
    tag = data.get("tag")
    control = data.get("control")

    # Notify OPC UA Server via SocketIO
    socketio.emit("control_tag", {"tag": tag, "control": control})

    if not control:
        sid = request.sid
        for topic, tags in last_message_cache.items():
            if tag in tags:
                value = tags[tag]["Value"]
                socketio.emit("mqtt_message", [tags[tag]], room=sid)
                # Notify OPC UA Server
                socketio.emit("tag_value_update", {"tag": tag, "value": value})
                break


@socketio.on("set_tag_value")
def set_tag_value(data):
    """Set tag value as per client request."""
    # print(data)
    tag = data.get("tag")
    value = data.get("value")

    # Notify OPC UA Server via SocketIO
    socketio.emit('tag_value_update', {'tag': tag, 'value': value})


if __name__ == "__main__":
    try:
        socketio.run(app, host="0.0.0.0",port = 5000, debug=False)
    except Exception as e:
        logger.error(f"Error running app: {e}")
