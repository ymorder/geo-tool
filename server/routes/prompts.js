'use strict';

const express = require('express');
const { db, now } = require('../db');
const { researchPrompts } = require('../services/prompt-research');

const router = express.Router({ mergeParams: true });

function rowToPrompt(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain_id: row.domain_id,
    text: row.text,
    intent: row.intent,
    source: row.source,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
  };
}

// List prompts for a domain
router.get('/', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = db
    .prepare('SELECT * FROM prompts WHERE domain_id = ? ORDER BY created_at DESC')
    .all(id);
  res.json({ prompts: rows.map(rowToPrompt) });
});

// Add one prompt manually
router.post('/', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'invalid_text' });
  const intent = req.body.intent || null;
  const source = req.body.source || 'user';
  const status = req.body.status || 'tracking';
  const info = db
    .prepare(
      `INSERT INTO prompts (domain_id, text, intent, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, text, intent, source, status, now());
  const row = db.prepare('SELECT * FROM prompts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ prompt: rowToPrompt(row) });
});

// Bulk add prompts
router.post('/bulk', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const items = Array.isArray(req.body.prompts) ? req.body.prompts : [];
  if (!items.length) return res.status(400).json({ error: 'no_prompts' });
  const stmt = db.prepare(
    `INSERT INTO prompts (domain_id, text, intent, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows) => {
    const inserted = [];
    for (const item of rows) {
      const text = (item.text || '').trim();
      if (!text) continue;
      const info = stmt.run(
        id,
        text,
        item.intent || null,
        item.source || 'user',
        item.status || 'tracking',
        now()
      );
      inserted.push(info.lastInsertRowid);
    }
    return inserted;
  });
  const ids = tx(items);
  const rows = db
    .prepare(`SELECT * FROM prompts WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  res.status(201).json({ prompts: rows.map(rowToPrompt), count: ids.length });
});

// Auto-research prompts for this domain
router.post('/research', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(id);
    if (!domain) return res.status(404).json({ error: 'not_found' });

    const limit = Math.min(parseInt(req.body.limit || '30', 10), 100);
    const include = req.body.types || ['seed', 'long-tail', 'competitor-based', 'category'];

    const result = await researchPrompts({
      domain,
      limit,
      include,
      existingPrompts: db
        .prepare('SELECT text FROM prompts WHERE domain_id = ?')
        .all(id)
        .map((r) => r.text),
    });

    const inserted = [];
    if (result.prompts && result.prompts.length) {
      const stmt = db.prepare(
        `INSERT INTO prompts (domain_id, text, intent, source, status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const tx = db.transaction((rows) => {
        for (const p of rows) {
          const info = stmt.run(
            id,
            p.text,
            p.intent || 'informational',
            'auto',
            'candidate',
            p.notes || null,
            now()
          );
          inserted.push(info.lastInsertRowid);
        }
      });
      tx(result.prompts);
    }

    res.json({
      added: inserted.length,
      prompts: db
        .prepare(`SELECT * FROM prompts WHERE id IN (${inserted.map(() => '?').join(',') || '0'})`)
        .all(...inserted)
        .map(rowToPrompt),
      debug: result.debug || null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/prompts/:promptId - mounted separately so we can address prompts by id
const standalone = express.Router();
standalone.delete('/:promptId', (req, res) => {
  const id = parseInt(req.params.promptId, 10);
  const info = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  res.json({ deleted: info.changes });
});

module.exports = { router, standalone, rowToPrompt };
