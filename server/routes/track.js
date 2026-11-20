'use strict';
const { createTrackPageRouter } = require('../lib/trackPage');

module.exports = { path: '/track', router: createTrackPageRouter() };
