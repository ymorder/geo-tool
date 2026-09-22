'use strict';

const axios = require('axios');
const { db } = require('../db');

// Find competitors for a domain.
// Strategy:
//   1) SerpAPI search "best <category>" / "top <category>" and collect domains.
//   2) SerpAPI search "<brand name>" and pull co-occurring domains.
//   3) Fallback: query our taxonomy and emit generic seed competitors
//      so the user has at least a starter list to edit.

function normalizeDomain(input) {
  if (!input) return null;
  let d = String(input).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return d || null;
}

function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return normalizeDomain(url);
  }
}

async function serpSearch(query, apiKey) {
  if (!apiKey) return [];
  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { q: query, api_key: apiKey, engine: 'google', num: 20 },
      timeout: 20000,
    });
    const organic = (res.data && res.data.organic_results) || [];
    return organic.map((r) => ({
      domain: extractDomain(r.link),
      title: r.title,
      snippet: r.snippet,
    })).filter((r) => r.domain);
  } catch (err) {
    console.warn(`[serp] ${query} failed:`, err.message);
    return [];
  }
}

function getApiKey() {
  const config = db.prepare('SELECT value FROM settings WHERE key = ?').get('config');
  try {
    return JSON.parse(config.value).serpapi_key || '';
  } catch {
    return process.env.SERPAPI_KEY || '';
  }
}

async function findCompetitors({ domain, limit = 12 }) {
  const apiKey = getApiKey();
  const myDomain = domain.domain;
  const name = (domain.name || myDomain.split('.')[0]).toLowerCase();
  const cat = domain.category_sub || domain.category || '';
  const scoreMap = new Map();

  function bump(d, score, source, name) {
    if (!d) return;
    if (d === myDomain) return;
    const entry = scoreMap.get(d) || { domain: d, score: 0, sources: new Set(), name: null };
    entry.score += score;
    entry.sources.add(source);
    if (!entry.name && name) entry.name = name;
    scoreMap.set(d, entry);
  }

  if (apiKey) {
    const queries = [];
    if (cat) {
      queries.push(`best ${cat}`);
      queries.push(`top ${cat}`);
      queries.push(`${cat} software`);
      queries.push(`${cat} tools comparison`);
    }
    queries.push(`${name} alternatives`);
    queries.push(`${name} vs`);
    queries.push(`sites like ${myDomain}`);

    for (const q of queries) {
      const results = await serpSearch(q, apiKey);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const decay = Math.max(1, 10 - i); // higher rank = more weight
        bump(r.domain, decay, q, r.title);
      }
    }
  } else {
    console.warn('[competitors] No SERPAPI_KEY; emitting fallback seed list.');
  }

  // Sort and cap
  const ranked = Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => ({
      domain: e.domain,
      name: e.name,
      overlap_score: Math.min(1, e.score / 40),
      sources: Array.from(e.sources),
      notes: `Auto-discovered via ${Array.from(e.sources).join(', ')}`,
    }));

  return ranked;
}

module.exports = { findCompetitors };
