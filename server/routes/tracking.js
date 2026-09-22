'use strict';

const express = require('express');
const { db } = require('../db');
const runner = require('../services/tracking-runner');

// Two routers:
//  - domainRouter is mounted under /api/domains/:id and exposes /track and /runs
//  - runRouter    is mounted under /api/runs and exposes /list and /:runId
const domainRouter = express.Router({ mergeParams: true });
const runRouter = express.Router();

// Trigger a tracking run for a domain
domainRouter.post('/track', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await runner.runTracking({
      domainId: id,
      promptIds: Array.isArray(req.body.promptIds) ? req.body.promptIds : null,
      enginesList: Array.isArray(req.body.engines) ? req.body.engines : null,
      trigger: req.body.trigger || 'manual',
    });
    if (result.error) {
      const status = result.error === 'domain_not_found' ? 404 : 400;
      return res.status(status).json(result);
    }
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

// List runs for a domain
domainRouter.get('/runs', (req, res) => {
  const id = parseInt(req.params.id, 10);
  res.json({ runs: runner.listRunsForDomain(id) });
});

// List all runs
runRouter.get('/list', (req, res) => {
  const limit = parseInt(req.query.limit || '30', 10);
  const rows = db
    .prepare(
      `SELECT r.*, d.domain AS domain_name
         FROM tracking_runs r
         JOIN domains d ON d.id = r.domain_id
         ORDER BY r.started_at DESC
         LIMIT ?`
    )
    .all(limit);
  res.json({
    runs: rows.map((r) => ({
      id: r.id,
      domain_id: r.domain_id,
      domain: r.domain_name,
      started_at: r.started_at,
      finished_at: r.finished_at,
      status: r.status,
      trigger: r.trigger,
      engines: r.engines ? JSON.parse(r.engines) : [],
      prompts_total: r.prompts_total,
      prompts_done: r.prompts_done,
      error: r.error,
    })),
  });
});

// Get a single run with results
runRouter.get('/:runId', (req, res) => {
  const runId = parseInt(req.params.runId, 10);
  const run = runner.getRun(runId);
  if (!run) return res.status(404).json({ error: 'not_found' });
  const results = runner.getResultsForRun(runId);
  res.json({ run, results });
});

module.exports = { domainRouter, runRouter };
