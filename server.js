/**
 * Following recommendations for chat room implementation: https://stackoverflow.com/questions/13364243/websocketserver-node-js-how-to-differentiate-clients
 * websocket documentation: https://www.npmjs.com/package/ws#api-docs
 * classes: https://github.com/websockets/ws/blob/master/doc/ws.md
 * 
 * Installing redis on windows using cygwin: 
 * https://gist.github.com/pcan/44cb2177647f029d457facb31da0883f
 * 
 * Configuring firebase with node.js: https://firebase.google.com/docs/admin/setup
 * https://firebase.google.com/docs/cloud-messaging/send-message
 * 
 * Written by: Philip Wu
 * Email: wu.phil@gmail.com
 */

/**
 * Imports
 */
const WebSocket = require('ws');
const url = require('url');
const redis = require("redis");
const querystring = require('querystring');
const config = require('./config.json');
var http = require('http');
var fs = require('fs');    
const Arango = require('arangojs').Database;
const firebase = require("firebase-admin");
const firebaseServiceAccount = require("./pawpal-38a88-firebase-adminsdk-j40hz-d1835dd85c.json");

firebase.initializeApp({
  credential: firebase.credential.cert(firebaseServiceAccount),
  databaseURL: "https://pawpal-38a88.firebaseio.com"
});


/**
 * Config
 */
const arangoUsername = config.arango.username;
const arangoPassword = config.arango.password;
const arangoIp = config.arango.ip;

/**
 * Functions
 */

/**
 * Init database connection to Arango
 * Documentation: https://www.arangodb.com/tutorials/tutorial-node-js/
 * https://github.com/arangodb/arangojs
 */

function connectArango() {
    var arangoUrl = 'http://'+arangoUsername+':'+arangoPassword+'@'+arangoIp+':8529';
    console.log("initArango:", arangoUrl);
    var db = new Arango(arangoUrl);
    
    db.useDatabase(config.arango.database);
    db.useBasicAuth(arangoUsername, arangoPassword);

    return db;
/*
    var userAuthCol = db.collection('UserAuth');
    console.log('db: ',db);


    var pCreate = collection.create();
    pCreate.then(function() {
        console.log('Collection created');  
    },
        err => console.error("Failed to create collection:", err)
    );    
        
    await pCreate;
    
    
    return userAuthCol;
    */  
}

/**
 * Connects to the ChatPayload collection
 */
function arangoChatPayload() {
    return connectArango().collection('ChatPayload');
}

/**
 * Connects to the ChatPayload collection
 */
function arangoChatRoom() {
    return connectArango().collection('ChatRoom');
}

/**
 * Init redis
 */
var subRedis = redis.createClient();
var pubRedis = redis.createClient();
subRedis.on("error", function (err) {
    console.log("SubRedis Error " + err);
});
pubRedis.on("error", function (err) {
    console.log("PubRedis Error " + err);
});



/**
 * Code start 
 */ 
/*
// Init arango
var topicCollection;
initArango().then(function(collection) {
    console.log("initArango completed: ");
    topicCollection = collection;
},
    err => console.error("Failed to init arango: ", err)
);
*/

 
// Init websocket server
var wssPort = 8888;
const wss = new WebSocket.Server({ port: wssPort });
console.log("WebSocketServer started on port %s", wssPort);

// TODO: move authentication code to request
wss.on('request', function(req) {
    console.log('onRequest');
})

/**
 * Link session, uid, ws_key to topic
 * Each user will have a different ws per topic
 * 
 * Map of topics to a List of websockets
 *   
 */ 
wss.on('connection', function connection(ws, req) {         
    // Parse url parameters from request
    console.log('request url: '+req.url);
    const params = url.parse(req.url, true);
    console.log('params: ', params);
    const userId = params.query.userId;
    const chatToken = params.query.chatToken;

    // Validate connection based on chatToken
    console.log('userId: ',userId);
    console.log('chatToken:', chatToken);

    // Assign the key to the websocket    
    var wsKey = req.headers['sec-websocket-key'];
    ws.key = wsKey;
    console.log('websocket-key: %s', ws.key);


    authenticate({
        webSocket: ws,
        userId: parseInt(userId), 
        chatToken: chatToken, 
        success: initWebSocket,
        denied: function(ws) {
            console.log('Terminating websocket connection');
            //ws.terminate();
        },
        error: function(ws) {
            console.log('Error')
            //ws.terminate();
        }
    });
});

/**
 * Authenticate websocket connection
 */
function authenticate({webSocket, userId, chatToken, success, denied, error}) {
    console.log('authenticate userId: ',userId);
    connectArango().query({
        query: "FOR ua IN UserAuth FILTER ua.userId==@userId RETURN ua",
        bindVars: {userId: userId},
    }).then(function(cursor) {
        cursor.next().then(function(userAuth) {
           console.log('userAuth: ', userAuth)
           if (userAuth && userAuth.chatToken == chatToken && userAuth.userId.toString() == userId) {
               console.log('access granted');
               // execute the callback               
               success(webSocket);
           } else {
               console.log('access denied.');
               denied(webSocket);
           }
        });
    }).catch(function(err){
      console.error('failed to query arango for UserAuth: ',err);  
      error(webSocket);
    });        
}

/**
 * chatRoom callback function
 */
function getChatRoom({chatRoomId, callback}) {
    console.log('getChatRoom '+chatRoomId);
    connectArango().query({
        query: "FOR cr IN ChatRoom FILTER cr._key == @chatRoomId RETURN cr",
        bindVars: {chatRoomId: chatRoomId},
    }).then(function(cursor) {
        cursor.next().then( function(chatRoom) {
            console.log('chatRoom: '+JSON.stringify(chatRoom));
            if (chatRoom) {
                callback(chatRoom);
            }
        });
    }).catch(function(err) {
      console.error('failed to query arango for ChatRoom: ',err);  
      //err(err);        
    });   
}

/**
 * Update the chatRoom with the GPS location
 */
function setChatRoomLocation({chatRoom, longitude, latitude}) {
    if (chatRoom) {
        var coords = {
            coordinates: [longitude, latitude],
            type: 'Point',
        };

        chatRoom.location = coords;
        
        // save to arango
        arangoChatRoom().update(chatRoom['_id'], chatRoom).then(
            () => console.log('ChatRoom updated'),
          meta => console.log('ChatRoom updated: ', meta._rev),
          err => console.error("Failed to save ChatRoom to arango: ", err)  
        );
        
    }       
}

function initWebSocket(ws) {
    try {
        
    // Monitor websocket connections with heartbeats  
    ws.isAlive = true;
    ws.on('pong', heartbeat);  
    
    // Handle messages from redis. Simply pass message to websocket
    subRedis.on("message", function(channel, message) {
        console.log("redis msg received on channel: "+channel+" msg: "+message);
        if (ws.readyState === WebSocket.OPEN) {
            console.log('websocket ready sending msg to %s', ws.key);  
            ws.send(message);
        } else {
            console.error("Websocket already closed. Unable to send msg: ", message);
            // TODO: Should we terminate the websocket?
        }
    });
    
      
    
    // A test message
    console.log('sending test message');
    ws.send(JSON.stringify({'topic':'global', 'message': 'WebSocket connected'}));
    
    // When a message is received broadcast to all websockets in topic  
    ws.on('message', function incoming(payload) {        
        console.log('websocket (%s) received: %s', ws.key, payload);  
          
        try {    
            // Convert message to JSON
            var json = JSON.parse(payload);
            var type = json.type;  
            var topic = json.topic;
            var uid = json.uid;
            var petIds = json.petIds;
            
            if (topic) {                        
                // Add timestamp to payload
                json.timestamp = new Date();
                
                console.log('json: ', json);
                if (type == 'subscribe') {
                    // subscribe to topic through Redis
                    subRedis.subscribe(topic);   
                } else if (type == 'message') {
                    sendFirebaseMessage(topic, 'PawPal message received', json.message, json.chatRoomId, uid);
                } else if (type == 'invitation') {
                    sendFirebaseMessage(topic, 'PawPal invitation received', json.message, json.chatRoomId, uid);                                
                } else if (type == 'acceptInvitation') {
                    // Save gps location to database
                    getChatRoom({
                       chatRoomId: json.chatRoomId,
                       callback: function(chatRoom) {
                        setChatRoomLocation({
                            chatRoom: chatRoom,
                            longitude: json.longitude,
                            latitude: json.latitude,
                        });
                       } 
                    });
                }                         
                    // Broadcast to notify new user joined chat
                    //pubRedis.publish(topic, JSON.stringify({'type': 'joinedChat', 'petIds':petIds, 'topic': topic}));             
                //} else if (type == 'message' || type == 'invitation' || type == 'cancelChat' || type == 'acceptedMarker') {
                    // Broadcast message to all connections of topic
                //console.log('broadcasting: ',json);                                
                pubRedis.publish(topic, JSON.stringify(json));                    
                //} 
                
                // Also broadcast via firebase
                
                // log payload           
                logPayload(JSON.stringify(json));
            }
        } catch (err) {
            console.error('Caught exception %s', err);
            console.error('stacktrace: %s', err.stack);      
        }
        
    });
    
    
  } catch (err) {
      console.error('Caught exception %s', err);
      console.trace();
  }    
}

function sendFirebaseMessage(topic, title, body, chatRoomId, uid) {
    console.log('firebase topic: '+topic+" uid: "+uid);
    var firebaseMsg = {
        topic: topic,
        notification: {
            title: title,
            body: body
        },
        data: {
            chatRoomId: chatRoomId,
            uid: uid.toString(),                        
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            sound: 'default',
        }
    }
    
    console.log('firebase payload:' +JSON.stringify(firebaseMsg));
    firebase.messaging().send(firebaseMsg).then((response) => {
        // Response is a message ID string.
        console.log('firebase successfully sent message:', response);                    
    }).catch((error) => {
        console.log('firebase error sending message:', error);
    });    
    
}

/**
 * Log all received payloads
 */
function logPayload(payload) {
    console.log('logPayload: ', payload);
    var jsonPayload = JSON.parse(payload);
    
    var now = new Date();
    var timestamp = now.getUTCFullYear() + "-"
        + ("0"+now.getUTCMonth()).slice(-2)
        + "-" + ("0"+now.getUTCDay()).slice(-2)
        + " "+("0"+now.getUTCHours()).slice(-2)
        + ":"+("0"+now.getUTCMinutes()).slice(-2)
        + ":"+("0"+now.getUTCSeconds()).slice(-2);
        
    console.log('logPayload timestamp: '+timestamp);
    console.log('chatRoomId: '+jsonPayload.chatRoomId);
    if (jsonPayload.chatRoomId) {
        console.log('saving chat payload');
        var chatPayload = {
            payload: jsonPayload,
            chatRoomId: jsonPayload.chatRoomId,
            timestamp: timestamp,
        }
        
        arangoChatPayload().save(chatPayload).then(
            () => console.log('ChatPayload saved?'),
          meta => console.log('ChatPayload saved: ', meta._rev),
          err => console.error("Failed to save ChatPayload to arango: ", err)  
        );
    }      
}


/** Periodically purge dead websocket connections 
 * taken from: https://www.npmjs.com/package/ws#api-docs
*/
function noop() {}
function heartbeat() {
  this.isAlive = true;
}

 
const interval = setInterval(function ping() {
  var removalKeys = new Set();  
    
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
        console.log('purging dead websocket connection');        
        ws.terminate();
        // track the key for removal
        removalKeys.add(ws.key);
    } else {    
        ws.isAlive = false;
        ws.ping(noop);
    }
  });
  
  // TODO: Clean up any terminated ws
  for( var i = 0; i < wss.clients.length; i++){ 
   if (removalKeys.has(wss.clients[i].key)) {
       console.log('splicing');
     wss.clients.splice(i, 1); 
   }
}
  
}, 30000);
