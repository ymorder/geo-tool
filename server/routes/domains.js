'use strict';

const express = require('express');
const { db, now } = require('../db');
const { categorize } = require('../services/categorize');

const router = express.Router();

function normalizeDomain(input) {
  if (!input) return null;
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return d || null;
}

function rowToDomain(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    name: row.name,
    category: row.category,
    category_id: row.category_id,
    category_sub: row.category_sub,
    category_source: row.category_source,
    confidence: row.confidence,
    signals: row.signals ? safeJson(row.signals) : [],
    runner_up: row.runner_up ? safeJson(row.runner_up) : null,
    schema_types: row.schema_types ? safeJson(row.schema_types) : [],
    title: row.title,
    meta_description: row.meta_description,
    created_at: row.created_at,
    updated_at: row.updated_at,
    prompt_count: row.prompt_count || 0,
    competitor_count: row.competitor_count || 0,
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// List all domains
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM prompts p WHERE p.domain_id = d.id) AS prompt_count,
              (SELECT COUNT(*) FROM competitors c WHERE c.domain_id = d.id) AS competitor_count
         FROM domains d
         ORDER BY d.created_at DESC`
    )
    .all();
  res.json({ domains: rows.map(rowToDomain) });
});

// Create a new domain + auto-categorize
router.post('/', async (req, res, next) => {
  try {
    const domain = normalizeDomain(req.body.domain);
    if (!domain) {
      return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid domain' });
    }

    const existing = db.prepare('SELECT * FROM domains WHERE domain = ?').get(domain);
    if (existing) {
      return res.status(409).json({ error: 'already_exists', domain: rowToDomain(existing) });
    }

    const name = req.body.name || domain;
    const ts = now();
    const insertInfo = db
      .prepare(
        `INSERT INTO domains (domain, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(domain, name, ts, ts);

    // Run categorization asynchronously after creation
    res.status(201).json({ id: insertInfo.lastInsertRowid, domain, status: 'categorizing' });

    // Fire and forget - categorize + update row
    categorize(domain)
      .then((cat) => {
        db.prepare(
          `UPDATE domains
             SET category = ?, category_id = ?, category_sub = ?,
                 category_source = ?, confidence = ?, signals = ?, runner_up = ?,
                 schema_types = ?, title = ?, meta_description = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          cat.category,
          cat.category_id,
          cat.category_sub,
          'taxonomy',
          cat.confidence,
          JSON.stringify(cat.signals || []),
          JSON.stringify(cat.runner_up || null),
          JSON.stringify(cat.schema_types || []),
          cat.title || null,
          cat.meta_description || null,
          now(),
          insertInfo.lastInsertRowid
        );
        console.log(`[categorize] ${domain} -> ${cat.category} / ${cat.category_sub}`);
      })
      .catch((err) => {
        console.error(`[categorize] failed for ${domain}:`, err.message);
        db.prepare('UPDATE domains SET category_source = ?, updated_at = ? WHERE id = ?').run(
          'failed',
          now(),
          insertInfo.lastInsertRowid
        );
      });
  } catch (err) {
    next(err);
  }
});

// Get one domain with detail
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM prompts p WHERE p.domain_id = d.id) AS prompt_count,
              (SELECT COUNT(*) FROM competitors c WHERE c.domain_id = d.id) AS competitor_count
         FROM domains d
         WHERE d.id = ?`
    )
    .get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ domain: rowToDomain(row) });
});

// Update metadata
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const allowed = ['name', 'category', 'category_sub', 'notes'];
  const updates = [];
  const values = [];
  for (const k of allowed) {
    if (k in req.body) {
      updates.push(`${k} = ?`);
      values.push(req.body[k]);
    }
  }
  if (!updates.length) return res.json({ domain: rowToDomain(existing) });
  updates.push('updated_at = ?');
  values.push(now());
  values.push(id);
  db.prepare(`UPDATE domains SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
  res.json({ domain: rowToDomain(updated) });
});

// Re-categorize
router.post('/:id/recategorize', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const cat = await categorize(existing.domain);
    db.prepare(
      `UPDATE domains
         SET category = ?, category_id = ?, category_sub = ?,
             category_source = ?, confidence = ?, signals = ?, runner_up = ?,
             schema_types = ?, title = ?, meta_description = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      cat.category,
      cat.category_id,
      cat.category_sub,
      'taxonomy',
      cat.confidence,
      JSON.stringify(cat.signals || []),
      JSON.stringify(cat.runner_up || null),
      JSON.stringify(cat.schema_types || []),
      cat.title || null,
      cat.meta_description || null,
      now(),
      id
    );
    const updated = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
    res.json({ domain: rowToDomain(updated) });
  } catch (err) {
    next(err);
  }
});

// Delete domain (cascades)
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const info = db.prepare('DELETE FROM domains WHERE id = ?').run(id);
  res.json({ deleted: info.changes });
});

module.exports = router;
module.exports.rowToDomain = rowToDomain;
module.exports.normalizeDomain = normalizeDomain;
