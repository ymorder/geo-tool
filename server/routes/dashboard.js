'use strict';

const express = require('express');
const { db } = require('../db');
const runner = require('../services/tracking-runner');

const router = express.Router({ mergeParams: true });

// Aggregated dashboard data for a domain
router.get('/', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
  if (!domain) return res.status(404).json({ error: 'not_found' });

  const promptsTotal = db
    .prepare('SELECT COUNT(*) AS c FROM prompts WHERE domain_id = ?')
    .get(id).c;
  const candidatesTotal = db
    .prepare(`SELECT COUNT(*) AS c FROM prompts WHERE domain_id = ? AND status = 'candidate'`)
    .get(id).c;
  const competitorsTotal = db
    .prepare('SELECT COUNT(*) AS c FROM competitors WHERE domain_id = ?')
    .get(id).c;
  const runsTotal = db
    .prepare('SELECT COUNT(*) AS c FROM tracking_runs WHERE domain_id = ?')
    .get(id).c;
  const lastRun = db
    .prepare('SELECT * FROM tracking_runs WHERE domain_id = ? ORDER BY started_at DESC LIMIT 1')
    .get(id);
  const openRecs = db
    .prepare(`SELECT COUNT(*) AS c FROM recommendations WHERE domain_id = ? AND status = 'open'`)
    .get(id).c;

  // Per-engine citation rate from latest completed run
  const latestResults = runner.getLatestResultsForDomain(id);

  const engineStats = {};
  const promptStats = {};
  for (const r of latestResults) {
    if (!engineStats[r.engine]) {
      engineStats[r.engine] = { engine: r.engine, total: 0, cited: 0, in_top10: 0, top_position: null };
    }
    const e = engineStats[r.engine];
    e.total += 1;
    if (r.cited) {
      e.cited += 1;
      if (r.position && (e.top_position === null || r.position < e.top_position)) {
        e.top_position = r.position;
      }
    }
    if (r.position && r.position <= 10) e.in_top10 += 1;
    if (!promptStats[r.prompt_id]) {
      promptStats[r.prompt_id] = {
        prompt_id: r.prompt_id,
        prompt_text: r.prompt_text,
        total: 0,
        cited: 0,
        engines: [],
      };
    }
    const p = promptStats[r.prompt_id];
    p.total += 1;
    if (r.cited) p.cited += 1;
    p.engines.push({ engine: r.engine, cited: r.cited, position: r.position });
  }

  // Gaps = prompts where no engine cited us
  const gaps = Object.values(promptStats)
    .filter((p) => p.cited === 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // Wins = prompts where every engine cited us
  const wins = Object.values(promptStats)
    .filter((p) => p.cited > 0 && p.cited === p.total)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  res.json({
    domain: {
      id: domain.id,
      domain: domain.domain,
      name: domain.name,
      category: domain.category,
      category_sub: domain.category_sub,
    },
    summary: {
      prompts: promptsTotal,
      candidates: candidatesTotal,
      competitors: competitorsTotal,
      runs: runsTotal,
      last_run: lastRun
        ? {
            id: lastRun.id,
            started_at: lastRun.started_at,
            finished_at: lastRun.finished_at,
            status: lastRun.status,
            prompts_total: lastRun.prompts_total,
            prompts_done: lastRun.prompts_done,
          }
        : null,
      open_recommendations: openRecs,
    },
    engine_stats: Object.values(engineStats).map((e) => ({
      ...e,
      citation_rate: e.total ? e.cited / e.total : 0,
      top10_rate: e.total ? e.in_top10 / e.total : 0,
    })),
    gaps,
    wins,
  });
});

module.exports = router;
