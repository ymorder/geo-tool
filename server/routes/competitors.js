'use strict';

const express = require('express');
const { db, now } = require('../db');
const { findCompetitors } = require('../services/competitors');

const router = express.Router({ mergeParams: true });

function rowToCompetitor(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain_id: row.domain_id,
    domain: row.domain,
    name: row.name,
    source: row.source,
    overlap_score: row.overlap_score,
    notes: row.notes,
    created_at: row.created_at,
  };
}

// List competitors for a domain
router.get('/', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = db
    .prepare('SELECT * FROM competitors WHERE domain_id = ? ORDER BY overlap_score DESC, created_at DESC')
    .all(id);
  res.json({ competitors: rows.map(rowToCompetitor) });
});

// Add a competitor manually
router.post('/', (req, res) => {
  const id = parseInt(req.params.id, 10);
  let domain = String(req.body.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!domain) return res.status(400).json({ error: 'invalid_domain' });

  try {
    const info = db
      .prepare(
        `INSERT INTO competitors (domain_id, domain, name, source, overlap_score, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        domain,
        req.body.name || null,
        'user',
        req.body.overlap_score || null,
        req.body.notes || null,
        now()
      );
    const row = db.prepare('SELECT * FROM competitors WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ competitor: rowToCompetitor(row) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'already_exists' });
    }
    throw err;
  }
});

// Auto-find competitors
router.post('/research', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
    if (!domain) return res.status(404).json({ error: 'not_found' });
    const limit = Math.min(parseInt(req.body.limit || '12', 10), 30);
    const found = await findCompetitors({ domain, limit });
    const inserted = [];
    const seen = new Set();
    const existing = db
      .prepare('SELECT domain FROM competitors WHERE domain_id = ?')
      .all(id)
      .map((r) => r.domain);
    for (const c of found) {
      if (existing.includes(c.domain) || seen.has(c.domain)) continue;
      seen.add(c.domain);
      try {
        const info = db
          .prepare(
            `INSERT INTO competitors (domain_id, domain, name, source, overlap_score, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            c.domain,
            c.name || null,
            'auto',
            c.overlap_score || null,
            c.notes || null,
            now()
          );
        inserted.push(info.lastInsertRowid);
      } catch (err) {
        if (!String(err.message).includes('UNIQUE')) throw err;
      }
    }
    const rows = db
      .prepare(`SELECT * FROM competitors WHERE id IN (${inserted.map(() => '?').join(',') || '0'})`)
      .all(...inserted);
    res.json({ added: inserted.length, competitors: rows.map(rowToCompetitor), debug: { tried: found.length } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/competitors/:competitorId
const standalone = express.Router();
standalone.delete('/:competitorId', (req, res) => {
  const id = parseInt(req.params.competitorId, 10);
  const info = db.prepare('DELETE FROM competitors WHERE id = ?').run(id);
  res.json({ deleted: info.changes });
});

module.exports = { router, standalone, rowToCompetitor };
