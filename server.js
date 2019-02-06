/**
 * Following recommendations for chat room implementation: https://stackoverflow.com/questions/13364243/websocketserver-node-js-how-to-differentiate-clients
 * websocket documentation: https://www.npmjs.com/package/ws#api-docs
 * classes: https://github.com/websockets/ws/blob/master/doc/ws.md
 * 
 * Installing redis on windows using cygwin: 
 * https://gist.github.com/pcan/44cb2177647f029d457facb31da0883f
 * 
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
var http = require('http');
var fs = require('fs');
    
const Arango = require('arangojs').Database;

/**
 * Config
 */
const arangoUsername = 'root';
const arangoPassword = 'arango';

/**
 * Functions
 */

/**
 * Init database connection to Arango
 * Documentation: https://www.arangodb.com/tutorials/tutorial-node-js/
 * https://github.com/arangodb/arangojs
 */

function connectArango() {
    var arangoUrl = 'http://'+arangoUsername+':'+arangoPassword+'@127.0.0.1:8529';
    console.log("initArango:", arangoUrl);
    var db = new Arango(arangoUrl);
    
    db.useDatabase('diggieDog');
    db.useBasicAuth('root', 'arango');

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

    authenticate({
        webSocket: ws,
        userId: parseInt(userId), 
        chatToken: chatToken, 
        success: initWebSocket,
        denied: function(ws) {
            console.log('Terminating websocket connection');
            ws.terminate();
        },
        error: function(ws) {
            ws.terminate();
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
      console.error('failed to query arango for UserAuth');  
      error(webSocket);
    });        
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
            console.log('websocket ready sending msg');  
            ws.send(message);
        } else {
            console.error("Websocket already closed. Unable to send msg: ", message);
        }
    });
    
    // Assign the key to the websocket
    /*
    var wsKey = req.headers['sec-websocket-key'];
    ws.key = wsKey;
    console.log('websocket-key: %s', ws.key);
    */  
    
    // A test message
    ws.send(JSON.stringify({'topic':'global', 'message': 'WebSocket connected'}));
    
    // When a message is received broadcast to all websockets in topic  
    ws.on('message', function incoming(payload) {        
        console.log('websocket received: %s', payload);    
        try {    
            // Convert message to JSON
            var json = JSON.parse(payload);
            var type = json.type;  
            var topic = json.topic;
            var uid = json.uid;
            var petIds = json.petIds;
            
            // Add timestamp to payload
            json.timestamp = new Date();
            
            console.log('json: ', json);
            if (type == 'subscribe') {
                // subscribe to topic through Redis
                subRedis.subscribe(topic);   
            }  
                // Broadcast to notify new user joined chat
                //pubRedis.publish(topic, JSON.stringify({'type': 'joinedChat', 'petIds':petIds, 'topic': topic}));             
            //} else if (type == 'message' || type == 'invitation' || type == 'cancelChat' || type == 'acceptedMarker') {
                // Broadcast message to all connections of topic
            console.log('broadcasting: ',json);                                
            pubRedis.publish(topic, JSON.stringify(json));                    
            //} 
            
            // log payload           
            logPayload(JSON.stringify(json));
        } catch (err) {
            console.error('Caught exception %s', err);
            console.error('stacktrace: %s', err.stack);      
        }
        
    });
    
    
  } catch (err) {
      console.error('Caught exception %s', err);
  }    
}

/**
 * Log all received payloads
 */
function logPayload(payload) {
    console.log('logPayload: ', payload);
    var postData = querystring.stringify({
        'payload': payload,
    });
    
    var postConfig = {host : 'localhost', port: 8080, 
      path: '/chatPayload/savePayload', method: 'POST',
      headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
      }     
    };
    
    var postRequest = http.request(postConfig, function(res) {
        console.log('logPayload response: ',res.statusCode);
    });
    
    postRequest.write(postData);
}


/** Periodically purge dead websocket connections 
 * taken from: https://www.npmjs.com/package/ws#api-docs
*/
function noop() {}
function heartbeat() {
  this.isAlive = true;
}
 
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    console.log('purging dead websocket connection');
    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);