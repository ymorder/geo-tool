'use strict';

// Smoke test - boots the app and hits a few endpoints without doing real
// network calls. Verifies schema, route registration, JSON shape and basic
// in-memory behaviour.

process.env.NODE_ENV = 'test';
process.env.SERPAPI_KEY = process.env.SERPAPI_KEY || '';
process.env.DB_PATH = './data/smoke.db';

const fs = require('fs');
const path = require('path');
try {
  fs.unlinkSync(path.resolve(process.cwd(), process.env.DB_PATH));
} catch {}

const app = require('../index');
const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    const port = 0;
    const server = app.listen(port, () => {
      const { port: actualPort } = server.address();
      const req = http.request(
        { hostname: '127.0.0.1', port: actualPort, path, method: 'GET' },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
            } catch (err) {
              resolve({ status: res.statusCode, body });
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  });
}

(async () => {
  let failures = 0;

  async function check(name, fn) {
    try {
      await fn();
      console.log(`OK   ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${name}: ${err.message}`);
    }
  }

  await check('health', async () => {
    const r = await get('/api/health');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.ok) throw new Error('not ok');
  });

  await check('engines list', async () => {
    const r = await get('/api/engines');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.body.engines)) throw new Error('engines not array');
    const keys = r.body.engines.map((e) => e.key);
    for (const k of ['google', 'bing', 'perplexity', 'copilot', 'you', 'deepseek', 'gemini', 'chatgpt', 'claude', 'grok']) {
      if (!keys.includes(k)) throw new Error(`missing engine ${k}`);
    }
  });

  await check('domains list (empty)', async () => {
    const r = await get('/api/domains');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.body.domains)) throw new Error('domains not array');
  });

  await check('runs list (empty)', async () => {
    const r = await get('/api/runs/list');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.body.runs)) throw new Error('runs not array');
  });

  await check('settings get', async () => {
    const r = await get('/api/settings');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.settings || !r.body.settings.config) throw new Error('missing settings');
  });

  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\nAll smoke tests passed');
    process.exit(0);
  }
})();
