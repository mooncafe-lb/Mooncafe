'use strict';
const db = require('../db');
const config = require('../config');
const { createAdminRouter } = require('../lib/adminRouter');

module.exports = { path: '/api/admin', router: createAdminRouter({ db, config }) };
