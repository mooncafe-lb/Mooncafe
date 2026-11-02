'use strict';
const db = require('../db');
const config = require('../config');
const { createPublicRouter } = require('../lib/publicRouter');

module.exports = { path: '/api', router: createPublicRouter({ db, config }) };
