'use strict';

const { db } = require('../db');

// Generate candidate prompts a domain is NOT appearing in yet.
// Approach:
//  1) Seed prompts from the site category + title.
//  2) Long-tail variations (question forms, comparison, "best of", "vs").
//  3) Competitor-based prompts using any competitors we already know.
//  4) Google "People Also Ask" style expansion via SerpAPI if key is set.
//  5) Fallback: deterministic template expansion (no API needed).
//
// All candidates get de-duplicated against existing prompts.

const QUESTION_PREFIXES = [
  'what is',
  'what are',
  'how does',
  'how to',
  'why',
  'which',
  'who is',
  'when to',
  'best',
  'top',
  'cheapest',
  'most reliable',
  'alternatives to',
  'vs',
  'compare',
  'review of',
];

const INTENT_PATTERNS = {
  informational: ['what is', 'how does', 'why', 'who is', 'when to'],
  commercial: ['best', 'top', 'review of', 'compare', 'vs', 'alternatives to', 'cheapest'],
  transactional: ['buy', 'pricing', 'sign up', 'book', 'order', 'subscribe'],
};

function inferIntent(text) {
  const lower = text.toLowerCase();
  for (const [intent, prefixes] of Object.entries(INTENT_PATTERNS)) {
    if (prefixes.some((p) => lower.startsWith(p))) return intent;
  }
  return 'informational';
}

function uniqByText(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item.text.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function templateExpand(domainObj) {
  const candidates = [];
  const domainName = domainObj.name || (domainObj.domain ? domainObj.domain.split('.')[0] : 'this site');
  const category = domainObj.category;
  const sub = domainObj.category_sub || domainObj.category || 'company';
  const subCat = sub;

  for (const prefix of QUESTION_PREFIXES) {
    candidates.push({ text: `${prefix} ${domainName}`, intent: inferIntent(`${prefix} ${domainName}`) });
    candidates.push({ text: `${prefix} ${subCat}`, intent: inferIntent(`${prefix} ${subCat}`) });
  }
  candidates.push({ text: `best ${subCat} tools`, intent: 'commercial' });
  candidates.push({ text: `best ${subCat} for small business`, intent: 'commercial' });
  candidates.push({ text: `${domainName} alternatives`, intent: 'commercial' });
  candidates.push({ text: `${domainName} pricing`, intent: 'transactional' });
  candidates.push({ text: `${domainName} review`, intent: 'commercial' });
  candidates.push({ text: `${domainName} vs`, intent: 'commercial' });
  return candidates;
}

function longTailFromExisting(existing) {
  // If we have existing prompts, build question variants from keywords.
  const out = [];
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'on', 'with', 'is', 'are']);
  for (const t of existing) {
    const words = t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w));
    if (!words.length) continue;
    const seed = words.slice(0, 4).join(' ');
    out.push({ text: `what is the best ${seed}`, intent: 'commercial' });
    out.push({ text: `how to choose ${seed}`, intent: 'informational' });
    out.push({ text: `${seed} examples`, intent: 'informational' });
  }
  return out;
}

function competitorBased(domain) {
  const out = [];
  const competitors = db
    .prepare('SELECT domain FROM competitors WHERE domain_id = ? LIMIT 10')
    .all(domain.id);
  for (const c of competitors) {
    const competitor = c.domain.split('.')[0];
    const myName = (domain.name || domain.domain.split('.')[0]).toLowerCase();
    out.push({ text: `${myName} vs ${competitor}`, intent: 'commercial' });
    out.push({ text: `${competitor} alternatives`, intent: 'commercial' });
  }
  return out;
}

async function serpPeopleAlsoAsk(query, apiKey) {
  if (!apiKey) return [];
  try {
    const axios = require('axios');
    const res = await axios.get('https://serpapi.com/search.json', {
      params: { q: query, api_key: apiKey, engine: 'google' },
      timeout: 15000,
    });
    const paa = (res.data && res.data.related_questions) || [];
    return paa
      .map((q) => ({ text: q.question, intent: 'informational', notes: 'PAA' }))
      .filter((q) => q.text);
  } catch {
    return [];
  }
}

async function researchPrompts({ domain, limit = 30, include = [], existingPrompts = [] }) {
  const existing = new Set(existingPrompts.map((t) => t.toLowerCase().trim()));
  let all = [];

  if (include.includes('seed') || include.includes('category')) {
    all = all.concat(templateExpand(domain));
  }
  if (include.includes('long-tail')) {
    all = all.concat(longTailFromExisting(existingPrompts.slice(0, 10)));
  }
  if (include.includes('competitor-based')) {
    all = all.concat(competitorBased(domain));
  }

  // Optional PAA from SerpAPI for a primary seed
  const config = db.prepare('SELECT value FROM settings WHERE key = ?').get('config');
  let apiKey = '';
  try {
    apiKey = JSON.parse(config.value).serpapi_key || '';
  } catch {}
  apiKey = apiKey || process.env.SERPAPI_KEY || '';

  if (apiKey && (include.includes('people-also-ask') || include.includes('seed'))) {
    const seed = `${(domain.name || domain.domain)} ${domain.category_sub || domain.category || ''}`.trim();
    const paa = await serpPeopleAlsoAsk(seed, apiKey);
    all = all.concat(paa);
  }

  // Filter duplicates vs existing prompts
  all = uniqByText(all).filter((p) => !existing.has(p.text.toLowerCase().trim()));

  // Stable cap
  all = all.slice(0, limit);

  return {
    prompts: all,
    debug: { generated: all.length, source: include.join(',') },
  };
}

module.exports = { researchPrompts, inferIntent };
