'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const uuid = require('uuid');
const WebSocket = require('ws');

const Room = require('./Room');

class Server {
    start(port, isSecure) {
        this.log('...started...');

        this.onConnection = this.onConnection.bind(this);

        this._waitingRooms = {};

        let server = null;

        if (isSecure) {
            server = https.createServer({
                cert: fs.readFileSync('./cert/cert.pem'),
                key: fs.readFileSync('./cert/key.pem'),
            });
        } else {
            server = http.createServer();
        }

        server.listen(port);

        this._server = new WebSocket.Server({server});

        this._server.on('connection', this.onConnection);
    }

    onConnection(client) {
        client.id = uuid.v4();

        this.log(`CONNECTED: ${client.id}`);

        client.once('message', this.onFirstMessage.bind(this, client));
    }

    onFirstMessage(client, message) {
        // this.log(`--> ${client.id} ${message}`);

        try {
            const {header, data} = JSON.parse(message);
            if (header === 'start') {
                this.onStartMessage(client, data);
            } else {
                throw new Error(`Invalid header: ${header}`);
            }
        } catch (error) {
            this.log(error);
            client.close();
        }
    }

    onStartMessage(client, data) {
        if (!data) {
            throw new Error('No data');
        }

        const gameMode = Object.values(Room.Type).find(gameMode => gameMode.id === data.gameMode);

        if (!gameMode) {
            throw new Error(`Wrong gameMode: ${data.gameMode}`);
        }

        let waitingRoom = this._waitingRooms[gameMode.id];

        if (!waitingRoom) {
            waitingRoom = this._waitingRooms[gameMode.id] = new Room(gameMode);
            waitingRoom.once('gameStarted', this.onGameStarted.bind(this));
        }

        waitingRoom.join(client);
    }

    onGameStarted(gameMode) {
        this._waitingRooms[gameMode.id] = null;
    }

    log(message) {
        console.log(`${new Date().toLocaleString()}: ${message}`);
    }
}

module.exports = Server;
