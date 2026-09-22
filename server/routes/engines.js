'use strict';

const express = require('express');
const engines = require('../services/ai-engines');

const router = express.Router();

// List engines
router.get('/', (req, res) => {
  res.json({ engines: engines.list() });
});

router.engines = engines.list();

module.exports = router;
