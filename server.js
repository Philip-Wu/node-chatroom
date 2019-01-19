/**
 * Following recommendations for chat room implementation: https://stackoverflow.com/questions/13364243/websocketserver-node-js-how-to-differentiate-clients
 * websocket documentation: https://www.npmjs.com/package/ws#api-docs
 * classes: https://github.com/websockets/ws/blob/master/doc/ws.md
 * 
 * Copyright 2019
 * Written by: Philip Wu
 * Email: wu.phil@gmail.com
 */

/**
 * Imports
 */
const WebSocket = require('ws');
const url = require('url');
 
 
/**
 * Code start 
 */ 
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
    const parameters = url.parse(req.url, true);
    
    // Assign the key to the websocket
    var wsKey = req.headers['sec-websocket-key'];
    ws.key = wsKey;
    console.log('websocket-key: %s', ws.key);  
    
    // When a message is received broadcast to all websockets in chatRoom  
    ws.on('message', function incoming(message) {        
        console.log('received: %s', message);    
        try {    
            // Convert message to JSON
            var json = JSON.parse(message);  
            var chatRoom = json.chatRoom;
            console.log('chatRoom: %s', chatRoom);
        } catch (err) {
            console.error('Caught exception %s', err);
            console.error('stacktrace: %s', err.stack);      
        }
        
    });
    
    ws.send('message is connected');
  } catch (err) {
      console.error('Caught exception %s', err);
  }
});