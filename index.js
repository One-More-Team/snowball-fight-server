'use strict';

const Server = require('./lib/Server');

const port = process.env.PORT || 8081;
const isSecure = false;

const server = new Server();
server.start(port, isSecure);
