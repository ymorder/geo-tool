'use strict';

const express = require('express');
const { db, getSetting, setSetting } = require('../db');

const router = express.Router();

const ALLOWED_KEYS = ['config'];

function mergeConfig(existing, patch) {
  const out = { ...(existing || {}) };
  if (!patch) return out;
  if (patch.engines) out.engines = { ...(out.engines || {}), ...patch.engines };
  for (const k of ['serpapi_key', 'openai_key', 'openai_model', 'track_cron']) {
    if (k in patch) out[k] = patch[k];
  }
  return out;
}

// Get current settings (never echo full API keys, only masked)
router.get('/', (req, res) => {
  const config = getSetting('config', {});
  const masked = { ...config };
  for (const k of ['serpapi_key', 'openai_key']) {
    if (masked[k]) {
      const v = String(masked[k]);
      masked[k] = v.length > 8 ? `${v.slice(0, 4)}...${v.slice(-4)}` : '****';
    }
  }
  res.json({ settings: { config: masked } });
});

// Update settings
router.post('/', (req, res) => {
  const current = getSetting('config', {});
  const merged = mergeConfig(current, req.body || {});
  setSetting('config', merged);
  res.json({ ok: true });
});

// Test SERPAPI key quickly
router.post('/test-serpapi', async (req, res) => {
  try {
    const axios = require('axios');
    const config = getSetting('config', {});
    const key = config.serpapi_key || process.env.SERPAPI_KEY;
    if (!key) return res.status(400).json({ ok: false, error: 'no_key' });
    const r = await axios.get('https://serpapi.com/search.json', {
      params: { q: 'test', api_key: key, engine: 'google' },
      timeout: 15000,
    });
    res.json({ ok: true, status: r.status, has_results: Array.isArray(r.data?.organic_results) });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.response?.status === 401 ? 'invalid_key' : err.message });
  }
});

module.exports = router;
