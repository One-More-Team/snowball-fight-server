'use strict';

const EventEmitter = require('events');
const WebSocket = require('ws');

const countdown = 3;
const spawnNum = 8;
const teamNum = 2;

class Room extends EventEmitter {
    constructor(gameMode) {
        super();

        this.log(`Room created [${gameMode.id}]`);

        this._timer = null;
        this._coundown = countdown;
        this._gameMode = gameMode;
        this._clientList = [];
        this._isGameStarted = false;
        this._isGameRunning = false;
    }

    join(client) {
        client.data = {};

        this._clientList.push(client);

        client.once('close', this.onClose.bind(this, client));

        if (this._clientList.length === this._gameMode.config.expectedPlayerNum) {
            this.start();
        } else {
            this.reportPlayerNum();
        }
    }

    reportPlayerNum() {
        this.broadcastData('playerNum', {
            playerNum: this._clientList.length,
            expectedPlayerNum: this._gameMode.config.expectedPlayerNum
        });
    }

    start() {
        const teamSpawnNum = spawnNum / teamNum;
        const teamSpawnLists = [];
        for (let i = 0; i < teamNum; ++i) {
            teamSpawnLists[i] = Array(spawnNum / teamNum).fill().map((_, index) => i * teamSpawnNum + index);
        }

        const players = this._clientList.map((_, index) => {
            const teamSpawnList = teamSpawnLists[(index % teamNum)];
            const randomIndex = Math.floor(Math.random() * teamSpawnList.length);

            return {
                spawnIndex: teamSpawnList.splice(randomIndex, 1)[0],
                id: index,
            };
        });

        this._clientList.forEach((client, index) => {
            client.once('message', this.onFirstMessage.bind(this, client));

            this.sendData(client, 'ready', {
                id: index,
                players,
            });
        });

        this._isGameStarted = true;
        this.emit('gameStarted', this._gameMode);
    }

    onFirstMessage(client, message) {
        // this.log(`--> ${client.id} ${message}`);

        try {
            const {header, data} = JSON.parse(message);
            if (header === 'ready') {
                this.onReady(client, data);
            } else {
                throw new Error(`Invalid header: ${header}`);
            }
        } catch (error) {
            this.log(error);
            client.close();
            this.onClose(client);
        }
    }

    onReady(client) {
        // this.log(`--> ${client.id} ${message}`);

        client.data.isReady = true;
        const isAllReady = this._clientList.every(client => client.data.isReady);

        if (isAllReady) {
            this._clientList.forEach(client => {
                client.once('message', this.onMessage.bind(this, client));
            });

            this.countdown();
        }
    }

    countdown() {
        if (this._coundown > 0) {
            this.broadcastData('countdown', {countdown: this._coundown});

            --this._coundown;
            this._timer = setTimeout(() => this.countdown(), 1000);
        } else {
            this._isGameRunning = true;
            this.broadcastData('start');
            this._timer = null;
        }
    }

    onClose(client) {
        if (this._isGameStarted) {
            if (this._timer) {
                clearTimeout(this._timer);
                this._timer = null;
            }

            // TODO Richard check if game is overed by this
        } else {
            const index = this._clientList.indexOf(client);
            this._clientList.splice(index, 1);
            this.reportPlayerNum();
        }

        this.log(`DISCONNECTED: ${client.id}`);
    }

    onMessage(client, message) {
        if (!this._isGameRunning) {
            this.log(`Incoming message while the game not running [${client.id}]: ${message}`);
            client.close();
            this.onClose(client);
        }

        // this.log(`--> ${client.id} ${message}`);

        try {
            const {header, data} = JSON.parse(message);

            switch (header) {
                case 'updatePosition':
                    this.onUpdatePositionMessage(client, data);
                    break;
                default:
                    throw new Error('Invalid header');
            }
        } catch (error) {
            this.log(error);
            client.close();
            this.onClose(client);
        }
    }

    onUpdatePositionMessage(client, data) {
        if (!data) {
            throw new Error('No data');
        }

        client.data.position = data;

        const dataObj = {
            ...data,
            id: this._clientList.indexOf(client),
        };

        this.broadcastData('updatePosition', dataObj, client);
    }

    sendMessage(client, message) {
        // this.log(`<-- ${client.id} ${message}`);
        client.send(message);
    }

    sendData(client, header, data) {
        const message = JSON.stringify({header, data});
        this.sendMessage(client, message);
    }

    broadcastData(header, data, senderClient) {
        const message = JSON.stringify({header, data});
        this.broadcastMessage(message, senderClient);
    }

    broadcastMessage(message, senderClient) {
        this._clientList.forEach(client => {
            const isSender = senderClient && senderClient === client;

            if (!isSender && client.readyState === WebSocket.OPEN) {
                this.sendMessage(client, message);
            }
        });
    }

    log(message) {
        console.log(`${new Date().toLocaleString()}: ${message}`);
    }
}

function roomTypeConfigGenerator(id, expectedPlayerNum, teamNum) {
    return {id, config: {expectedPlayerNum, teamNum}};
}

Room.Type = {
    VERSUS: roomTypeConfigGenerator('versus', 2, 2),
    WINGMAN: roomTypeConfigGenerator('wingman', 4, 2),
    DEATHMATCH: roomTypeConfigGenerator('deathmatch', 4, 1),
};

module.exports = Room;
