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
    
//const Arango = require('arangojs').Database;

/**
 * Config
 */
//const arangoUsername = 'root';
//const arangoPassword = 'arango';

/**
 * Functions
 */

/**
 * Init database connection to Arango
 * Documentation: https://www.arangodb.com/tutorials/tutorial-node-js/
 * https://github.com/arangodb/arangojs
 */
/* 
async function initArango() {
    var arangoUrl = 'http://'+arangoUsername+':'+arangoPassword+'@127.0.0.1:8529';
    console.log("initArango:", arangoUrl);
    var db = new Arango(arangoUrl);
    
    db.useDatabase('diggieDog');
    db.useBasicAuth('root', 'arango');
    // TODO: Create chatRoom collection if it doesn't exist
    var collection = db.collection('chatRoom');
    console.log('db: ',db);
    
    var pCreate = collection.create();
    pCreate.then(function() {
        console.log('Collection created');  
    },
        err => console.error("Failed to create collection:", err)
    );    
        
    await pCreate;
    
    return collection;  
}*/

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
var chatRoomCollection;
initArango().then(function(collection) {
    console.log("initArango completed: ");
    chatRoomCollection = collection;
},
    err => console.error("Failed to init arango: ", err)
);
*/

 
// Init websocket server
var wssPort = 8888;
const wss = new WebSocket.Server({ port: wssPort });
console.log("WebSocketServer started on port %s", wssPort);


/**
 * Link session, uid, ws_key to chatRoom
 * Each user will have a different ws per chatRoom
 * 
 * Map of chatRooms to a List of websockets
 *   
 */ 
wss.on('connection', function connection(ws, req) {
  try {      
  
    // Parse url parameters from request
    console.log('request url: '+req.url);
    const params = url.parse(req.url, true);
    console.log('params: ', params);
    var chatRoom = params.query.chatRoom;
    console.log('onConnection chatRoom: %s', chatRoom);
    
    // Store chatRoom along with websocket
    ws.chatRoom = chatRoom;
    
    // subscribe to chatRoom through Redis
    subRedis.subscribe(chatRoom);
    // Handle messages from redis. Simply pass message to websocket
    subRedis.on("message", function(channel, message) {
        console.log("redis msg received on channel: "+channel+" msg: "+message);  
        ws.send(message);
    });

    
    // Assign the key to the websocket
    var wsKey = req.headers['sec-websocket-key'];
    ws.key = wsKey;
    console.log('websocket-key: %s', ws.key);  
    
    // A test message
    ws.send('message is connected');
    
    // When a message is received broadcast to all websockets in chatRoom  
    ws.on('message', function incoming(payload) {        
        console.log('websocket received: %s', payload);    
        try {    
            // Convert message to JSON
            var json = JSON.parse(payload);  
            var chatRoom = json.chatRoom;
            var message = json.message;
            console.log('chatRoom: %s', chatRoom);
            
            // Broadcast message to all connections of chatroom
            pubRedis.publish(chatRoom, message);
        } catch (err) {
            console.error('Caught exception %s', err);
            console.error('stacktrace: %s', err.stack);      
        }
        
    });
    
    
  } catch (err) {
      console.error('Caught exception %s', err);
  }
});