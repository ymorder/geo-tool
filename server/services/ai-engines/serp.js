'use strict';

const axios = require('axios');
const { makeResult, isHostOf } = require('./base');
const { db } = require('../../db');

function getApiKey() {
  const config = db.prepare('SELECT value FROM settings WHERE key = ?').get('config');
  try {
    return JSON.parse(config.value).serpapi_key || '';
  } catch {
    return process.env.SERPAPI_KEY || '';
  }
}

async function googleQuery({ prompt, targetDomain }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return makeResult({
      ok: false,
      status: 'no_api_key',
      error: 'SERPAPI_KEY not set. Add it in Settings or .env to enable Google tracking.',
    });
  }

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        q: prompt,
        api_key: apiKey,
        engine: 'google',
        num: 20,
      },
      timeout: 30000,
    });

    const organic = (res.data && res.data.organic_results) || [];
    const aiOverview = res.data?.ai_overview || null;
    const aiOverviewSources = Array.isArray(aiOverview?.sources)
      ? aiOverview.sources
          .map((s) => s.link || s.url)
          .filter((u) => /^https?:\/\//.test(u || ''))
      : [];

    // Position in organic
    let position = null;
    let organicHit = null;
    organic.forEach((r, i) => {
      if (position === null && isHostOf(r.link, targetDomain)) {
        position = i + 1;
        organicHit = r;
      }
    });

    const sources = [
      ...organic.map((r) => r.link).filter(Boolean),
      ...aiOverviewSources,
    ];

    // AI overview citation: any source under our target domain
    const aiOverviewCited = aiOverviewSources.some((s) => isHostOf(s, targetDomain));

    // Build excerpt: AI Overview text if available, else first snippets
    let excerpt = '';
    if (aiOverview?.text) {
      excerpt = aiOverview.text;
    } else if (aiOverview?.answer) {
      excerpt = aiOverview.answer;
    } else {
      excerpt = organic
        .slice(0, 5)
        .map((r) => `${r.title}\n${r.snippet}`)
        .join('\n\n');
    }

    return makeResult({
      ok: true,
      status: 'ok',
      cited: position !== null || aiOverviewCited,
      position,
      citationUrl: organicHit?.link || aiOverviewSources.find((s) => isHostOf(s, targetDomain)) || null,
      sources,
      excerpt,
      rawResponse: JSON.stringify({
        organic: organic.slice(0, 10).map((r) => ({ title: r.title, link: r.link, snippet: r.snippet })),
        ai_overview_present: !!aiOverview,
        ai_overview_cited: aiOverviewCited,
      }, null, 2).slice(0, 30000),
    });
  } catch (err) {
    return makeResult({ ok: false, status: 'error', error: err.message });
  }
}

async function bingQuery({ prompt, targetDomain }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return makeResult({
      ok: false,
      status: 'no_api_key',
      error: 'SERPAPI_KEY not set. Add it in Settings or .env to enable Bing tracking.',
    });
  }

  try {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        q: prompt,
        api_key: apiKey,
        engine: 'bing',
        count: 20,
      },
      timeout: 30000,
    });

    const organic = (res.data && res.data.organic_results) || [];
    let position = null;
    let organicHit = null;
    organic.forEach((r, i) => {
      if (position === null && isHostOf(r.link, targetDomain)) {
        position = i + 1;
        organicHit = r;
      }
    });

    const sources = organic.map((r) => r.link).filter(Boolean);
    const excerpt = organic
      .slice(0, 5)
      .map((r) => `${r.title}\n${r.snippet}`)
      .join('\n\n');

    return makeResult({
      ok: true,
      status: 'ok',
      cited: position !== null,
      position,
      citationUrl: organicHit?.link || null,
      sources,
      excerpt,
      rawResponse: JSON.stringify(
        organic.slice(0, 10).map((r) => ({ title: r.title, link: r.link, snippet: r.snippet })),
        null,
        2
      ).slice(0, 30000),
    });
  } catch (err) {
    return makeResult({ ok: false, status: 'error', error: err.message });
  }
}

module.exports = { googleQuery, bingQuery };
