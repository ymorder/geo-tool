'use strict';

const { db, now } = require('../db');
const engines = require('./ai-engines');
const { generateRecommendations } = require('./recommender');

let activeRun = null;

function listEnabledEngines() {
  const config = db.prepare('SELECT value FROM settings WHERE key = ?').get('config');
  let cfg = {};
  try { cfg = JSON.parse(config.value); } catch {}
  return Object.entries(cfg.engines || {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

async function runTracking({ domainId, promptIds = null, enginesList = null, trigger = 'manual' }) {
  if (activeRun && activeRun.domain_id === domainId) {
    return { error: 'run_already_active', run_id: activeRun.id };
  }

  const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId);
  if (!domain) return { error: 'domain_not_found' };

  const promptRows = promptIds
    ? db.prepare(`SELECT * FROM prompts WHERE id IN (${promptIds.map(() => '?').join(',')}) AND domain_id = ?`).all(...promptIds, domainId)
    : db.prepare('SELECT * FROM prompts WHERE domain_id = ? ORDER BY id ASC').all(domainId);

  if (!promptRows.length) {
    return { error: 'no_prompts' };
  }

  const enabledEngines = (enginesList && enginesList.length ? enginesList : listEnabledEngines())
    .filter((k) => engines.get(k));

  if (!enabledEngines.length) {
    return { error: 'no_engines_enabled' };
  }

  const cap = parseInt(process.env.MAX_PROMPTS_PER_RUN || '200', 10);
  const prompts = promptRows.slice(0, cap);

  const ts = now();
  const runInfo = db
    .prepare(
      `INSERT INTO tracking_runs
         (domain_id, started_at, status, trigger, engines, prompts_total, prompts_done)
       VALUES (?, ?, 'running', ?, ?, ?, 0)`
    )
    .run(domainId, ts, trigger, JSON.stringify(enabledEngines), prompts.length);

  const runId = runInfo.lastInsertRowid;
  activeRun = { id: runId, domain_id: domainId };

  // Async loop - we resolve with run_id immediately and continue in background
  runInBackground({
    runId,
    domain,
    prompts,
    enabledEngines,
  }).catch((err) => {
    console.error(`[run ${runId}] fatal:`, err);
    db.prepare(`UPDATE tracking_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?`).run(
      'failed',
      err.message,
      now(),
      runId
    );
  }).finally(() => {
    if (activeRun && activeRun.id === runId) activeRun = null;
  });

  return { run_id: runId, prompts: prompts.length, engines: enabledEngines };
}

async function runInBackground({ runId, domain, prompts, enabledEngines }) {
  // Process engines in parallel, prompts in series within each engine to avoid bursts.
  await Promise.all(
    enabledEngines.map(async (engineKey) => {
      const engine = engines.get(engineKey);
      if (!engine) return;
      for (const prompt of prompts) {
        let result;
        try {
          result = await engine.query({
            prompt: prompt.text,
            targetDomain: domain.domain,
          });
        } catch (err) {
          result = {
            ok: false,
            status: 'error',
            error: err.message,
            cited: 0,
            sources: [],
            raw_response: null,
            response_excerpt: null,
          };
        }
        try {
          db.prepare(
            `INSERT INTO tracking_results
               (run_id, prompt_id, engine, status, position, cited, citation_url, sources,
                raw_response, response_excerpt, error, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            runId,
            prompt.id,
            engineKey,
            result.status || (result.ok ? 'ok' : 'error'),
            result.position || null,
            result.cited ? 1 : 0,
            result.citation_url || null,
            JSON.stringify(result.sources || []),
            result.raw_response || null,
            result.response_excerpt || null,
            result.error || null,
            now()
          );
          db.prepare('UPDATE tracking_runs SET prompts_done = prompts_done + 1 WHERE id = ?').run(runId);
        } catch (err) {
          console.error(`[run ${runId}] failed to insert result for prompt ${prompt.id} / ${engineKey}:`, err.message);
        }
      }
    })
  );

  db.prepare('UPDATE tracking_runs SET status = ?, finished_at = ? WHERE id = ?').run(
    'completed',
    now(),
    runId
  );

  // Best-effort recommendation refresh
  try {
    await generateRecommendations({ domainId: domain.id, sourceRunId: runId });
  } catch (err) {
    console.warn(`[run ${runId}] recommendations refresh failed:`, err.message);
  }

  console.log(`[run ${runId}] done`);
}

function getRun(runId) {
  const row = db.prepare('SELECT * FROM tracking_runs WHERE id = ?').get(runId);
  if (!row) return null;
  return {
    id: row.id,
    domain_id: row.domain_id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    trigger: row.trigger,
    engines: row.engines ? JSON.parse(row.engines) : [],
    prompts_total: row.prompts_total,
    prompts_done: row.prompts_done,
    error: row.error,
  };
}

function listRunsForDomain(domainId, limit = 30) {
  const rows = db
    .prepare('SELECT * FROM tracking_runs WHERE domain_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(domainId, limit);
  return rows.map((row) => ({
    id: row.id,
    domain_id: row.domain_id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    trigger: row.trigger,
    engines: row.engines ? JSON.parse(row.engines) : [],
    prompts_total: row.prompts_total,
    prompts_done: row.prompts_done,
    error: row.error,
  }));
}

function getResultsForRun(runId) {
  const rows = db
    .prepare(
      `SELECT r.*, p.text AS prompt_text
         FROM tracking_results r
         JOIN prompts p ON p.id = r.prompt_id
        WHERE r.run_id = ?
        ORDER BY r.prompt_id, r.engine`
    )
    .all(runId);
  return rows.map((r) => ({
    id: r.id,
    prompt_id: r.prompt_id,
    prompt_text: r.prompt_text,
    engine: r.engine,
    status: r.status,
    position: r.position,
    cited: !!r.cited,
    citation_url: r.citation_url,
    sources: r.sources ? JSON.parse(r.sources) : [],
    response_excerpt: r.response_excerpt,
    error: r.error,
    created_at: r.created_at,
  }));
}

function getLatestResultsForDomain(domainId, enginesFilter = null) {
  const rows = db
    .prepare(
      `SELECT r.*, p.text AS prompt_text
         FROM tracking_results r
         JOIN prompts p ON p.id = r.prompt_id
         JOIN tracking_runs run ON run.id = r.run_id
        WHERE run.domain_id = ?
          AND run.id = (SELECT id FROM tracking_runs WHERE domain_id = ? AND status = 'completed' ORDER BY finished_at DESC LIMIT 1)
          ${enginesFilter ? `AND r.engine IN (${enginesFilter.map(() => '?').join(',')})` : ''}
        ORDER BY r.prompt_id, r.engine`
    )
    .all(domainId, domainId, ...(enginesFilter || []));
  return rows.map((r) => ({
    id: r.id,
    run_id: r.run_id,
    prompt_id: r.prompt_id,
    prompt_text: r.prompt_text,
    engine: r.engine,
    status: r.status,
    position: r.position,
    cited: !!r.cited,
    citation_url: r.citation_url,
    sources: r.sources ? JSON.parse(r.sources) : [],
    response_excerpt: r.response_excerpt,
    error: r.error,
    created_at: r.created_at,
  }));
}

module.exports = {
  runTracking,
  getRun,
  listRunsForDomain,
  getResultsForRun,
  getLatestResultsForDomain,
  listEnabledEngines,
};
