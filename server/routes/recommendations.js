'use strict';

const express = require('express');
const { db, now } = require('../db');
const { generateRecommendations } = require('../services/recommender');

const router = express.Router({ mergeParams: true });

function rowToRec(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain_id: row.domain_id,
    prompt_id: row.prompt_id,
    prompt_text: row.prompt_text || null,
    type: row.type,
    priority: row.priority,
    title: row.title,
    description: row.description,
    action_items: row.action_items ? JSON.parse(row.action_items) : [],
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// List recommendations for a domain
router.get('/', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const rows = db
    .prepare(
      `SELECT r.*, p.text AS prompt_text
         FROM recommendations r
         LEFT JOIN prompts p ON p.id = r.prompt_id
         WHERE r.domain_id = ?
         ORDER BY CASE r.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                  r.created_at DESC`
    )
    .all(id);
  res.json({ recommendations: rows.map(rowToRec) });
});

// Force a recommendation refresh
router.post('/generate', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ids = await generateRecommendations({ domainId: id });
    const rows = db.prepare(`SELECT * FROM recommendations WHERE id IN (${ids.map(() => '?').join(',') || '0'})`).all(...ids);
    res.json({ generated: ids.length, recommendations: rows.map(rowToRec) });
  } catch (err) {
    next(err);
  }
});

// Update recommendation status
router.patch('/:recId', (req, res) => {
  const recId = parseInt(req.params.recId, 10);
  const existing = db.prepare('SELECT * FROM recommendations WHERE id = ?').get(recId);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const allowed = ['status', 'priority'];
  const updates = [];
  const values = [];
  for (const k of allowed) {
    if (k in req.body) {
      updates.push(`${k} = ?`);
      values.push(req.body[k]);
    }
  }
  if (!updates.length) return res.json({ recommendation: rowToRec(existing) });
  updates.push('updated_at = ?');
  values.push(now());
  values.push(recId);
  db.prepare(`UPDATE recommendations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM recommendations WHERE id = ?').get(recId);
  res.json({ recommendation: rowToRec(updated) });
});

module.exports = router;
module.exports.rowToRec = rowToRec;
