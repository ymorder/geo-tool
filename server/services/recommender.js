'use strict';

const { db, now } = require('../db');

// Build recommendations based on the most recent tracking run(s).
// Strategy:
//  1) For each prompt, count how many engines cited us. 0 => "missing".
//  2) For missing prompts, look at the sources that DID get cited and
//     generate concrete advice based on signals (Wikipedia, Reddit,
//     competitor domains, gov/edu sites, etc.).
//  3) For AI-only engines, propose content-format actions (FAQ blocks,
//     structured data, comparison tables, statistics, expert quotes).

const TRUSTED_DOMAINS = [
  'wikipedia.org', 'reddit.com', 'quora.com',
  'github.com', 'stackoverflow.com', 'medium.com',
  'youtube.com', 'linkedin.com', 'twitter.com', 'x.com',
  'forbes.com', 'techcrunch.com', 'wired.com', 'nytimes.com',
  'bbc.com', 'cnn.com', 'theguardian.com', 'wsj.com',
  '.gov', '.edu',
];

function classifySource(url) {
  if (!url) return 'unknown';
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
  for (const t of TRUSTED_DOMAINS) {
    if (host === t || host.endsWith('.' + t) || host.endsWith(t)) return t;
  }
  return host;
}

function buildPromptRecommendation({ prompt, resultsByEngine, targetDomain }) {
  const total = resultsByEngine.length;
  const okResults = resultsByEngine.filter((r) => r.status === 'ok');
  const erroredEngines = resultsByEngine.filter((r) => r.status !== 'ok').map((r) => r.engine);
  const cited = resultsByEngine.filter((r) => r.cited).length;
  const sourcesAll = Array.from(
    new Set(resultsByEngine.flatMap((r) => r.sources || []))
  );
  const otherDomains = Array.from(
    new Set(
      sourcesAll
        .map((s) => {
          try {
            return new URL(s).hostname.toLowerCase().replace(/^www\./, '');
          } catch {
            return null;
          }
        })
        .filter((h) => h && h !== targetDomain && !h.endsWith(targetDomain))
    )
  );
  const sourceTypes = Array.from(new Set(otherDomains.map(classifySource)));
  const missingEngines = okResults.filter((r) => !r.cited).map((r) => r.engine);
  const enginesWithCitations = okResults.filter((r) => r.cited).map((r) => r.engine);

  const actionItems = [];
  const descriptionParts = [];

  if (okResults.length === 0) {
    descriptionParts.push(
      `Tracking failed on every engine we tried for "${prompt.text}". Engines reported: ${erroredEngines.join(', ') || 'unknown errors'}.`
    );
    descriptionParts.push(
      'Check API keys (SerpAPI for Google/Bing) and session cookies (ChatGPT, Claude, Gemini, Grok).'
    );
    actionItems.push('Add SERPAPI_KEY in Settings to enable Google + Bing tracking.');
    if (erroredEngines.some((e) => ['chatgpt', 'claude', 'gemini', 'grok'].includes(e))) {
      actionItems.push('Capture session cookies for the auth-required AI engines (see README).');
    }
    return {
      type: 'tracking_setup',
      priority: 'high',
      title: `No tracking data for: ${prompt.text}`,
      description: descriptionParts.join(' '),
      action_items: actionItems,
      meta: {
        engines_total: total,
        engines_ok: 0,
        engines_errored: erroredEngines,
      },
    };
  }

  if (cited === 0) {
    descriptionParts.push(
      `You do not appear in any of the ${okResults.length} engines that returned a result for "${prompt.text}".`
    );
  } else {
    descriptionParts.push(
      `You appear in ${cited} of ${okResults.length} engines (${enginesWithCitations.join(', ')}) for "${prompt.text}".`
    );
  }

  if (missingEngines.length) {
    actionItems.push(`Prioritise coverage on: ${missingEngines.join(', ')}.`);
  }

  if (sourceTypes.includes('wikipedia.org')) {
    actionItems.push('Wikipedia appears in citations. Pitch a neutral, citable page; add structured data and outbound citations.');
  }
  if (sourceTypes.includes('reddit.com')) {
    actionItems.push('Reddit threads rank. Seed authentic conversations, answer with expertise, and link your canonical page.');
  }
  if (sourceTypes.some((t) => t.includes('forbes.com') || t.includes('wired.com') || t.includes('techcrunch.com'))) {
    actionItems.push('Tier-1 press outlets appear. Build a media list and pitch original data or commentary.');
  }
  if (sourceTypes.some((t) => t.endsWith('.gov') || t.endsWith('.edu'))) {
    actionItems.push('Authoritative .gov/.edu sources appear. Build relationships for citations or guest contributions.');
  }
  if (otherDomains.length) {
    const top = otherDomains.slice(0, 5).join(', ');
    actionItems.push(`Review the top cited sources: ${top}. Mirror their content structure and add unique angles.`);
  }

  // Format-level advice for AI engines
  if (missingEngines.some((e) => e !== 'google' && e !== 'bing')) {
    actionItems.push('Add an FAQ block, a comparison table, a TL;DR, and statistics to your canonical page so LLMs can extract a clean answer.');
    actionItems.push('Add structured data (Article, FAQPage, Organization) and make sure the page has a clear first-paragraph answer to this exact question.');
  }

  if (actionItems.length === 0) {
    actionItems.push('You are already cited everywhere we checked. Look at prompt variants and expand coverage.');
  }

  let priority = 'low';
  if (cited === 0) priority = 'high';
  else if (cited / okResults.length < 0.5) priority = 'medium';

  const topSources = otherDomains.slice(0, 10);
  return {
    type: 'citation_gap',
    priority,
    title: cited === 0 ? `Not cited for: ${prompt.text}` : `Partial coverage for: ${prompt.text}`,
    description: descriptionParts.join(' '),
    action_items: actionItems,
    meta: {
      engines_total: okResults.length,
      engines_citing: cited,
      engines_missing: missingEngines,
      engines_errored: erroredEngines,
      top_sources: topSources,
      source_type_breakdown: sourceTypes,
    },
  };
}

async function generateRecommendations({ domainId, sourceRunId = null }) {
  const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId);
  if (!domain) return [];

  // Pull all results for the run(s). When sourceRunId is null we use the most
  // recent completed run. We do NOT filter on status='ok' so prompts whose
  // engines all errored still surface as actionable recommendations.
  const latestResults = sourceRunId
    ? db
        .prepare(
          `SELECT r.*, p.text AS prompt_text
             FROM tracking_results r
             JOIN tracking_runs run ON run.id = r.run_id
             JOIN prompts p ON p.id = r.prompt_id
            WHERE run.domain_id = ? AND r.run_id = ?`
        )
        .all(domainId, sourceRunId)
    : db
        .prepare(
          `SELECT r.*, p.text AS prompt_text
             FROM tracking_results r
             JOIN tracking_runs run ON run.id = r.run_id
             JOIN prompts p ON p.id = r.prompt_id
            WHERE run.domain_id = ?
              AND r.run_id = (SELECT id FROM tracking_runs
                              WHERE domain_id = ? AND status = 'completed'
                              ORDER BY finished_at DESC LIMIT 1)`
        )
        .all(domainId, domainId);

  if (!latestResults.length) return [];

  // Group results by prompt
  const byPrompt = new Map();
  for (const r of latestResults) {
    if (!byPrompt.has(r.prompt_id)) {
      byPrompt.set(r.prompt_id, { prompt_id: r.prompt_id, prompt_text: r.prompt_text, results: [] });
    }
    byPrompt.get(r.prompt_id).results.push({
      engine: r.engine,
      cited: !!r.cited,
      status: r.status,
      sources: r.sources ? JSON.parse(r.sources) : [],
    });
  }

  const created = [];
  const insert = db.prepare(
    `INSERT INTO recommendations
       (domain_id, prompt_id, type, priority, title, description, action_items, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  );

  for (const [, group] of byPrompt) {
    // Delete prior "open" recommendations for this prompt in this domain
    db.prepare(
      `DELETE FROM recommendations WHERE domain_id = ? AND prompt_id = ? AND status = 'open'`
    ).run(domainId, group.prompt_id);

    const rec = buildPromptRecommendation({
      prompt: { id: group.prompt_id, text: group.prompt_text },
      resultsByEngine: group.results,
      targetDomain: domain.domain,
    });

    const ts = now();
    const info = insert.run(
      domainId,
      group.prompt_id,
      rec.type,
      rec.priority,
      rec.title,
      rec.description,
      JSON.stringify(rec.action_items),
      ts,
      ts
    );
    created.push(info.lastInsertRowid);
  }

  return created;
}

module.exports = { generateRecommendations, buildPromptRecommendation };
