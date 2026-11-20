'use strict';
const path = require('path');

// Serves the tracking page itself for /track/<anything>. The page asks the API for the order with the token in the link;
// an invalid token only shows a "not valid" message, so this route needs no database and reveals nothing.
function createTrackPageRouter() {
  const express = require('express');
  const router = express.Router();
  const file = path.join(__dirname, '..', '..', 'public', 'track.html');
  router.get('/:token', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });   // the token must not leak through referrers
    res.sendFile(file);
  });
  return router;
}

module.exports = { createTrackPageRouter };
