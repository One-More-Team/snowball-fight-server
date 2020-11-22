'use strict';

const EventEmitter = require('events');
const WebSocket = require('ws');

const countdown = 3;
const spawnNum = 8;
const teamNum = 2;
const webRrtParticipantLimit = 2;

class Room extends EventEmitter {
    constructor(gameMode) {
        super();

        this.log(`Room created [${gameMode.id}]`);

        this._timer = null;
        this._coundown = countdown;
        this._gameMode = gameMode;
        this._clientList = [];
        this._isGameStarted = false;
        this._isAllUserReady = false;
        this._isGameRunning = false;
    }

    join(client, data) {
        client.data = {userName: data.userName};

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

        const players = this._clientList.map(({data}, index) => {
            const teamSpawnList = teamSpawnLists[(index % teamNum)];
            const randomIndex = Math.floor(Math.random() * teamSpawnList.length);

            return {
                spawnIndex: teamSpawnList.splice(randomIndex, 1)[0],
                id: index,
                userName: data.userName,
            };
        });

        this._clientList.forEach((client, index) => {
            client.on('message', this.onMessage.bind(this, client));

            this.sendData(client, 'ready', {
                id: index,
                players,
            });
        });

        this._isGameStarted = true;
        this.emit('gameStarted', this._gameMode);
    }

    onReadyMessage(client) {
        if (client.data.isReady) {
            throw new Error('Client was already ready');
        }

        client.data.isReady = true;
        this._isAllUserReady = this._clientList.every(client => client.data.isReady);

        if (this._isAllUserReady) {
            this.countdown();
        }
    }

    onSendWebRtcOfferMessage(client, data) {
        const partners = this.getWebRtcPartners(client);
        partners.forEach(client => {
            this.sendData(client, 'sendWebRTCOffer', data);
        });
    }

    onSendWebRtcAnswerMessage(client, data) {
        const partners = this.getWebRtcPartners(client);

        // Wrong logic...but good for currently hardcoded values (for only 2 participants)
        partners.forEach(client => {
            this.sendData(client, 'sendWebRTCAnswer', data);
        });
    }

    getWebRtcPartners(client) {
        const playerNum = this._gameMode.config.expectedPlayerNum;
        const currentClientIndex = this._clientList.indexOf(client);
        let partnerClientList;
        if (playerNum <= webRrtParticipantLimit) {
            partnerClientList = [...this._clientList];
            partnerClientList.splice(currentClientIndex, 1);

            return partnerClientList;
        } else {
            const teamPlayerNum = playerNum / teamNum;

            if (teamPlayerNum <= webRrtParticipantLimit) {
                const teamIndex = Math.floor(currentClientIndex / teamPlayerNum);
                const firstTeamPlayerIndex = teamIndex * teamPlayerNum;
                partnerClientList = this._clientList.slice(firstTeamPlayerIndex, firstTeamPlayerIndex + teamPlayerNum);

                const newCurrentClientIndex = partnerClientList.indexOf(client);
                partnerClientList.splice(newCurrentClientIndex, 1);

                return partnerClientList;
            }

            return [];
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
        // this.log(`--> ${client.id} ${message}`);

        try {
            const {header, data} = JSON.parse(message);

            switch (header) {
                case 'ready':
                    this.onReadyMessage(client, data);
                    break;
                case 'updatePosition':
                    this.onUpdatePositionMessage(client, data);
                    break;
                case 'sendWebRTCOffer':
                    this.onSendWebRtcOfferMessage(client, data);
                    break;
                case 'sendWebRTCAnswer':
                    this.onSendWebRtcAnswerMessage(client, data);
                    break;
                case 'respawn':
                    this.onRespawnMessage(client, data);
                    break;
                default:
                    throw new Error(`Invalid header: ${header}`);
            }
        } catch (error) {
            this.log(error);
            client.close();
            this.onClose(client);
        }
    }

    onRespawnMessage(client, data) {
        if (!this._isGameRunning) {
            this.log(`"respawn" message while the game not running [${client.id}]`);
            client.close();
            this.onClose(client);
        }

        if (!data) {
            throw new Error('No data');
        }

        const teamSpawnSlotNum = spawnNum / teamNum;
        const teamPlayerNum = spawnNum / this._clientList.length;
        const teamIndex = Math.floor(data.id / teamPlayerNum);
        const spawnIndex = teamIndex * teamSpawnSlotNum + Math.floor(Math.random() * teamSpawnSlotNum);

        const dataObj = {
            ...data,
            spawnIndex,
        };

        this.broadcastData('respawn', dataObj);
    }

    onUpdatePositionMessage(client, data) {
        if (!this._isGameRunning) {
            this.log(`"updatePosition" message while the game not running [${client.id}]`);
            client.close();
            this.onClose(client);
        }

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
