/**
 * Following recommendations for chat room implementation: https://stackoverflow.com/questions/13364243/websocketserver-node-js-how-to-differentiate-clients
 * websocket documentation: https://www.npmjs.com/package/ws#api-docs
 * classes: https://github.com/websockets/ws/blob/master/doc/ws.md
 * 
 * Written by: Philip Wu
 * Email: wu.phil@gmail.com
 */

/**
 * Imports
 */
const WebSocket = require('ws');
const url = require('url');
const Arango = require('arangojs').Database;

/**
 * Config
 */
const arangoUsername = 'root';
const arangoPassword = 'arango';

/**
 * Init database connection to Arango
 * Documentation: https://www.arangodb.com/tutorials/tutorial-node-js/
 * https://github.com/arangodb/arangojs
 */ 
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
}

var chatRoomCollection;
initArango().then(function(collection) {
    console.log("initArango completed: ");
    chatRoomCollection = collection;
},
    err => console.error("Failed to init arango: ", err)
);


 
/**
 * Code start 
 */ 
var wssPort = 8888;
const wss = new WebSocket.Server({ port: wssPort });
console.log("WebSocketServer started on port %s", wssPort);
// Attach map to server
wss.chatRoomMap = new Map();


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
    var chatRoom = params.chatRoom;
    console.log('onConnection chatRoom: %s', chatRoom);
    
    // Add ws to chatRoom map
    if (wss.chatRoomMap.get(chatRoom)) {
        wss.chatRoomMap.get(chatRoom).push(ws);
    } else {
        wss.chatRoomMap.set(chatRoom, [ws]);
    }
    console.log('onConnect chatRoomMap: %s', wss.chatRoomMap.get(chatRoom));
    
    // Assign the key to the websocket
    var wsKey = req.headers['sec-websocket-key'];
    ws.key = wsKey;
    console.log('websocket-key: %s', ws.key);  
    
    // A test message
    ws.send('message is connected');
    
    // When a message is received broadcast to all websockets in chatRoom  
    ws.on('message', function incoming(payload) {        
        console.log('received: %s', payload);    
        try {    
            // Convert message to JSON
            var json = JSON.parse(payload);  
            var chatRoom = json.chatRoom;
            var message = json.message;
            console.log('chatRoom: %s', chatRoom);
            
            // Broadcast message to all connections of chatroom
            console.log('onMessage chatRoomMap: %s', wss.chatRoomMap.get(chatRoom));
            if (message && wss.chatRoomMap.get(chatRoom)) {
                wss.chatRoomMap.get(chatRoom).forEach( function(chatRoomWs) {
                    console.log('broadcasting to: %s', ws.key);
                    chatRoomWs.send(message);    
                });
            }
        } catch (err) {
            console.error('Caught exception %s', err);
            console.error('stacktrace: %s', err.stack);      
        }
        
    });
    
    
  } catch (err) {
      console.error('Caught exception %s', err);
  }
});