'use strict';

const cron = require('node-cron');
const { db } = require('./db');
const runner = require('./services/tracking-runner');

let scheduledTask = null;
let lastExpression = null;

function readCronExpression() {
  const config = db.prepare('SELECT value FROM settings WHERE key = ?').get('config');
  try {
    const cfg = JSON.parse(config.value);
    return cfg.track_cron || process.env.TRACK_CRON || '0 6 * * *';
  } catch {
    return process.env.TRACK_CRON || '0 6 * * *';
  }
}

async function tick() {
  const domains = db.prepare('SELECT id FROM domains').all();
  console.log(`[scheduler] running tracking across ${domains.length} domains`);
  for (const d of domains) {
    try {
      const r = await runner.runTracking({ domainId: d.id, trigger: 'cron' });
      console.log(`[scheduler] domain ${d.id} -> ${JSON.stringify(r)}`);
    } catch (err) {
      console.error(`[scheduler] domain ${d.id} failed:`, err.message);
    }
  }
}

function start() {
  const expr = readCronExpression();
  if (!cron.validate(expr)) {
    console.warn(`[scheduler] invalid cron expression: ${expr}, falling back to "0 6 * * *"`);
    return;
  }
  if (scheduledTask && lastExpression === expr) return;
  if (scheduledTask) scheduledTask.stop();

  scheduledTask = cron.schedule(expr, () => {
    tick().catch((err) => console.error('[scheduler] tick failed:', err));
  });
  lastExpression = expr;
  console.log(`[scheduler] tracking cron registered: "${expr}"`);
}

function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

module.exports = { start, stop, tick };
