'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { getSetting, setSetting } = require('./db');
const scheduler = require('./scheduler');
const domainsRoutes = require('./routes/domains');
const promptsRoutes = require('./routes/prompts');
const competitorsRoutes = require('./routes/competitors');
const trackingRoutes = require('./routes/tracking');
const recommendationsRoutes = require('./routes/recommendations');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');
const enginesRoutes = require('./routes/engines');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Public static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/domains', domainsRoutes);
app.use('/api/domains/:id/prompts', promptsRoutes.router);
app.use('/api/domains/:id/competitors', competitorsRoutes.router);
app.use('/api/domains/:id/recommendations', recommendationsRoutes);
app.use('/api/domains/:id/dashboard', dashboardRoutes);
app.use('/api/domains/:id', trackingRoutes.domainRouter);
app.use('/api/runs', trackingRoutes.runRouter);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/engines', enginesRoutes);
app.use('/api/prompts', promptsRoutes.standalone);
app.use('/api/competitors', competitorsRoutes.standalone);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'geo-tool',
    version: '0.1.0',
    time: new Date().toISOString(),
    engines: enginesRoutes.engines,
  });
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// Centralised error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(status).json({
    error: err.code || 'server_error',
    message: err.message || 'Internal server error',
    details: err.details,
  });
});

// Seed default settings once
function ensureDefaultSettings() {
  const defaults = {
    engines: {
      google: true,
      bing: true,
      perplexity: true,
      copilot: true,
      you: true,
      deepseek: true,
      gemini: false,
      chatgpt: false,
      claude: false,
      grok: false,
    },
    serpapi_key: process.env.SERPAPI_KEY || '',
    openai_key: process.env.OPENAI_API_KEY || '',
    openai_model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    track_cron: process.env.TRACK_CRON || '0 6 * * *',
  };
  const current = getSetting('config');
  if (!current) {
    setSetting('config', defaults);
  }
}

if (require.main === module) {
  ensureDefaultSettings();
  app.listen(PORT, () => {
    console.log(`geo-tool listening on http://localhost:${PORT}`);
    scheduler.start();
  });
}

module.exports = app;
