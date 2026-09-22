'use strict';

const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || r.statusText);
    return data;
  },
  async patch(path, body) {
    const r = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || r.statusText);
    return data;
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
};

function tpl(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

function fmtDur(start, end) {
  if (!start) return '—';
  if (!end) return 'running...';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

function toast(msg, type = 'info') {
  console.log(`[${type}]`, msg);
  // Minimal inline toast
  const node = el('div', { class: `toast toast-${type}` }, msg);
  node.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 14px;background:#1a1a1f;color:white;border-radius:8px;z-index:1000;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

// Routing
const routes = [
  { match: /^#\/?$/, handler: renderDomains },
  { match: /^#\/runs\/?$/, handler: renderAllRuns },
  { match: /^#\/settings\/?$/, handler: renderSettings },
  { match: /^#\/d\/(\d+)\/dashboard\/?$/, handler: renderDomainTab.bind(null, 'dashboard') },
  { match: /^#\/d\/(\d+)\/prompts\/?$/, handler: renderDomainTab.bind(null, 'prompts') },
  { match: /^#\/d\/(\d+)\/competitors\/?$/, handler: renderDomainTab.bind(null, 'competitors') },
  { match: /^#\/d\/(\d+)\/runs\/?$/, handler: renderDomainTab.bind(null, 'runs') },
  { match: /^#\/d\/(\d+)\/recommendations\/?$/, handler: renderDomainTab.bind(null, 'recommendations') },
  { match: /^#\/d\/(\d+)\/?$/, handler: renderDomainTab.bind(null, 'dashboard') },
];

function navigate() {
  const hash = location.hash || '#/';
  for (const route of routes) {
    const m = hash.match(route.match);
    if (m) {
      try {
        route.handler(...m.slice(1));
      } catch (err) {
        app.innerHTML = `<div class="card">Error: ${err.message}</div>`;
        console.error(err);
      }
      $$('.topnav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === hash || (a.getAttribute('href') === '#/' && hash === '#/')));
      return;
    }
  }
  app.innerHTML = `<div class="card">Page not found</div>`;
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', navigate);

// ===== Domains list =====
async function renderDomains() {
  app.innerHTML = '';
  app.appendChild(tpl('tpl-domains'));
  $('#add-domain').addEventListener('click', promptAddDomain);

  const { domains } = await api.get('/api/domains');
  const list = $('#domain-list');
  if (!domains.length) {
    list.appendChild(el('div', { class: 'empty' }, 'No domains yet. Add one to start tracking.'));
    return;
  }
  for (const d of domains) {
    const card = tpl('domain-card');
    card.querySelector('.domain-name').textContent = d.name || d.domain;
    card.querySelector('.domain-url').textContent = d.domain;
    const badge = card.querySelector('.badge');
    badge.textContent = d.category || 'Categorizing...';
    badge.className = 'badge ' + (d.category ? '' : 'muted');
    card.querySelector('.stat-prompts').textContent = d.prompt_count;
    card.querySelector('.stat-competitors').textContent = d.competitor_count;
    card.querySelector('.stat-recs').textContent = d.open_recommendations ?? 0;
    const link = card.querySelector('a');
    link.href = `#/d/${d.id}/dashboard`;
    list.appendChild(card);
  }
}

async function promptAddDomain() {
  const dialog = el('dialog', {},
    el('h3', {}, 'Add a domain'),
    el('p', { class: 'muted small' }, 'Categorization runs automatically once you add it.'),
    el('input', { type: 'text', id: 'new-domain', placeholder: 'example.com' }),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: submit }, 'Add'),
      el('button', { class: 'btn ghost', onclick: () => dialog.close() }, 'Cancel'),
    ),
  );
  document.body.appendChild(dialog);
  dialog.showModal();
  $('#new-domain', dialog).focus();

  async function submit() {
    const domain = $('#new-domain', dialog).value.trim();
    if (!domain) return;
    try {
      await api.post('/api/domains', { domain });
      dialog.close();
      toast('Domain added', 'success');
      navigate();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

// ===== Domain detail =====
async function renderDomainTab(tab, idStr) {
  const id = parseInt(idStr, 10);
  app.innerHTML = '';
  app.appendChild(tpl('tpl-domain'));

  // Patch tab hrefs with id
  $$('.tabs a').forEach((a) => {
    a.href = a.href.replace(':id', id);
    a.classList.toggle('active', a.dataset.tab === tab);
  });

  const { domain } = await api.get(`/api/domains/${id}`);
  $('.d-name').textContent = domain.name || domain.domain;
  $('.d-url').textContent = domain.domain;
  $('.d-cat').textContent = domain.category || 'Pending...';
  $('.d-sub').textContent = domain.category_sub || '—';
  $('.d-conf').textContent = domain.confidence ? `${Math.round(domain.confidence * 100)}%` : '—';

  $('#track-now').addEventListener('click', async () => {
    try {
      const r = await api.post(`/api/domains/${id}/track`, {});
      toast(`Run ${r.run_id} started`, 'success');
      navigate();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#recategorize').addEventListener('click', async () => {
    toast('Re-categorizing...', 'info');
    try {
      await api.post(`/api/domains/${id}/recategorize`);
      toast('Done', 'success');
      navigate();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const body = $('.tab-body');
  body.innerHTML = '';

  if (tab === 'dashboard') return renderDashboardTab(id, body);
  if (tab === 'prompts') return renderPromptsTab(id, body);
  if (tab === 'competitors') return renderCompetitorsTab(id, body);
  if (tab === 'runs') return renderRunsTab(id, body);
  if (tab === 'recommendations') return renderRecommendationsTab(id, body);
}

async function renderDashboardTab(id, body) {
  body.appendChild(tpl('tpl-dashboard'));
  const data = await api.get(`/api/domains/${id}/dashboard`);
  $('.s-prompts').textContent = data.summary.prompts;
  $('.s-candidates').textContent = data.summary.candidates;
  $('.s-competitors').textContent = data.summary.competitors;
  $('.s-recs').textContent = data.summary.open_recommendations;
  $('.s-lastrun').textContent = data.summary.last_run
    ? fmtDate(data.summary.last_run.started_at)
    : '—';

  const rows = $('.engine-rows');
  if (!data.engine_stats.length) {
    rows.innerHTML = `<tr><td colspan="6" class="empty">No tracking data yet. Run a tracking pass to see engine stats.</td></tr>`;
  } else {
    for (const e of data.engine_stats) {
      const rate = Math.round(e.citation_rate * 100);
      const cls = rate >= 60 ? 'green' : rate >= 30 ? '' : 'red';
      rows.appendChild(el('tr', {},
        el('td', {}, e.engine),
        el('td', {}, String(e.cited)),
        el('td', {}, String(e.total)),
        el('td', {}, el('span', { class: `bar ${cls}` }, el('span', { style: `width:${rate}%` })), ` ${rate}%`),
        el('td', {}, String(e.in_top10)),
        el('td', {}, e.top_position ? `#${e.top_position}` : '—'),
      ));
    }
  }

  const gaps = $('.gaps');
  if (!data.gaps.length) gaps.appendChild(el('div', { class: 'empty' }, 'No gaps detected. Nice.'));
  for (const g of data.gaps) {
    gaps.appendChild(el('div', { class: 'gap-item' },
      el('div', { class: 'prompt' }, g.prompt_text),
      el('div', { class: 'muted small' }, `Not cited in any of ${g.total} engines.`),
    ));
  }

  const wins = $('.wins');
  if (!data.wins.length) wins.appendChild(el('div', { class: 'empty' }, 'No wins yet.'));
  for (const w of data.wins) {
    wins.appendChild(el('div', { class: 'win-item' },
      el('div', { class: 'prompt' }, w.prompt_text),
      el('div', { class: 'muted small' }, `Cited in all ${w.total} engines.`),
    ));
  }
}

async function renderPromptsTab(id, body) {
  body.appendChild(tpl('tpl-prompts'));
  $('#add-prompt').addEventListener('click', () => promptAddPrompt(id));
  $('#research-prompts').addEventListener('click', () => researchPrompts(id));

  const { prompts } = await api.get(`/api/domains/${id}/prompts`);
  const tbody = $('.prompt-rows');
  if (!prompts.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No prompts. Add some manually or auto-research.</td></tr>`;
    return;
  }
  for (const p of prompts) {
    const tr = el('tr', {},
      el('td', {}, p.text),
      el('td', {}, el('span', { class: 'tag' }, p.intent || '—')),
      el('td', {}, el('span', { class: 'tag' }, p.source)),
      el('td', {}, el('span', { class: 'badge ' + (p.status === 'tracking' ? 'green' : 'muted') }, p.status)),
      el('td', {}, el('button', { class: 'btn danger', onclick: async () => {
        await api.del(`/api/prompts/${p.id}`);
        navigate();
      }}, 'Delete')),
    );
    tbody.appendChild(tr);
  }
}

async function promptAddPrompt(id) {
  const dialog = el('dialog', {},
    el('h3', {}, 'Add prompt'),
    el('textarea', { id: 'new-prompt', placeholder: 'best marketing automation tools for SMBs' }),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: submit }, 'Add'),
      el('button', { class: 'btn ghost', onclick: () => dialog.close() }, 'Cancel'),
    ),
  );
  document.body.appendChild(dialog);
  dialog.showModal();

  async function submit() {
    const text = $('#new-prompt', dialog).value.trim();
    if (!text) return;
    try {
      await api.post(`/api/domains/${id}/prompts`, { text });
      dialog.close();
      navigate();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

async function researchPrompts(id) {
  try {
    const r = await api.post(`/api/domains/${id}/prompts/research`, { limit: 30 });
    toast(`Added ${r.added} candidate prompts`, 'success');
    navigate();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderCompetitorsTab(id, body) {
  body.appendChild(tpl('tpl-competitors'));
  $('#add-competitor').addEventListener('click', () => promptAddCompetitor(id));
  $('#research-competitors').addEventListener('click', () => researchCompetitors(id));

  const { competitors } = await api.get(`/api/domains/${id}/competitors`);
  const tbody = $('.competitor-rows');
  if (!competitors.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No competitors yet.</td></tr>`;
    return;
  }
  for (const c of competitors) {
    tbody.appendChild(el('tr', {},
      el('td', {}, c.domain),
      el('td', {}, c.name || '—'),
      el('td', {}, el('span', { class: 'tag' }, c.source)),
      el('td', {}, c.overlap_score != null ? `${Math.round(c.overlap_score * 100)}%` : '—'),
      el('td', { class: 'muted small' }, c.notes || '—'),
    ));
  }
}

async function promptAddCompetitor(id) {
  const dialog = el('dialog', {},
    el('h3', {}, 'Add competitor'),
    el('input', { type: 'text', id: 'new-comp', placeholder: 'competitor.com' }),
    el('div', { class: 'row gap' },
      el('button', { class: 'btn primary', onclick: submit }, 'Add'),
      el('button', { class: 'btn ghost', onclick: () => dialog.close() }, 'Cancel'),
    ),
  );
  document.body.appendChild(dialog);
  dialog.showModal();

  async function submit() {
    const domain = $('#new-comp', dialog).value.trim();
    if (!domain) return;
    try {
      await api.post(`/api/domains/${id}/competitors`, { domain });
      dialog.close();
      navigate();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

async function researchCompetitors(id) {
  try {
    const r = await api.post(`/api/domains/${id}/competitors/research`, { limit: 12 });
    toast(`Added ${r.added} competitors`, 'success');
    navigate();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderRunsTab(id, body) {
  body.appendChild(tpl('tpl-runs'));
  const { runs } = await api.get(`/api/domains/${id}/runs`);
  const tbody = $('.run-rows');
  if (!runs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">No runs yet. Click "Track now" to start.</td></tr>`;
    return;
  }
  for (const r of runs) {
    const tr = el('tr', { class: 'clickable', onclick: () => showRunDetail(id, r.id) },
      el('td', {}, `#${r.id}`),
      el('td', {}, fmtDate(r.started_at)),
      el('td', {}, fmtDur(r.started_at, r.finished_at)),
      el('td', {}, el('span', { class: 'badge ' + (r.status === 'completed' ? 'green' : r.status === 'failed' ? 'red' : 'yellow') }, r.status)),
      el('td', {}, `${r.prompts_done}/${r.prompts_total}`),
      el('td', {}, (r.engines || []).join(', ')),
    );
    tbody.appendChild(tr);
  }
}

async function showRunDetail(domainId, runId) {
  const detail = $('.run-detail');
  detail.innerHTML = '<div class="muted small">Loading...</div>';
  const data = await api.get(`/api/runs/${runId}`);
  const byPrompt = new Map();
  for (const r of data.results) {
    if (!byPrompt.has(r.prompt_id)) byPrompt.set(r.prompt_id, { prompt: r.prompt_text, engines: [] });
    byPrompt.get(r.prompt_id).engines.push(r);
  }
  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', {}, `Run #${runId}`));
  card.appendChild(el('div', { class: 'muted small' }, `${data.results.length} results · ${data.run.engines.join(', ')}`));
  const table = el('table', { class: 'data' },
    el('thead', {}, el('tr', {},
      el('th', {}, 'Prompt'),
      ...data.run.engines.map((e) => el('th', {}, e)),
    )),
  );
  const tbody = el('tbody');
  for (const [promptId, g] of byPrompt) {
    const tr = el('tr', {}, el('td', {}, g.prompt));
    for (const eng of data.run.engines) {
      const r = g.engines.find((x) => x.engine === eng);
      if (!r) { tr.appendChild(el('td', {}, '—')); continue; }
      if (r.status !== 'ok') {
        tr.appendChild(el('td', {}, el('span', { class: 'badge red' }, r.status)));
      } else if (r.cited) {
        const txt = r.position ? `#${r.position}` : 'cited';
        tr.appendChild(el('td', {}, el('span', { class: 'badge green' }, txt)));
      } else {
        tr.appendChild(el('td', {}, el('span', { class: 'badge muted' }, '—')));
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
  detail.innerHTML = '';
  detail.appendChild(card);
}

async function renderRecommendationsTab(id, body) {
  body.appendChild(tpl('tpl-recommendations'));
  $('#refresh-recs').addEventListener('click', async () => {
    try {
      await api.post(`/api/domains/${id}/recommendations/generate`);
      navigate();
    } catch (err) { toast(err.message, 'error'); }
  });

  const { recommendations } = await api.get(`/api/domains/${id}/recommendations`);
  const list = $('.rec-list');
  if (!recommendations.length) {
    list.appendChild(el('div', { class: 'empty' }, 'No recommendations yet. Run a tracking pass first.'));
    return;
  }
  for (const r of recommendations) {
    const item = el('div', { class: `rec-item priority-${r.priority}` },
      el('div', { class: 'row gap spread' },
        el('div', {},
          el('div', { class: 'prompt' }, r.title),
          r.prompt_text ? el('div', { class: 'muted small' }, r.prompt_text) : null,
        ),
        el('div', { class: 'row gap' },
          el('span', { class: `badge ${r.priority === 'high' ? 'red' : r.priority === 'medium' ? 'yellow' : 'green'}` }, r.priority),
          el('span', { class: 'badge muted' }, r.status),
          r.status === 'open' ? el('button', { class: 'btn', onclick: async () => {
            await api.patch(`/api/recommendations/${r.id}`, { status: 'in_progress' });
            navigate();
          }}, 'Start') : null,
          r.status !== 'done' ? el('button', { class: 'btn primary', onclick: async () => {
            await api.patch(`/api/recommendations/${r.id}`, { status: 'done' });
            navigate();
          }}, 'Mark done') : null,
        ),
      ),
      el('p', { class: 'muted small' }, r.description),
      el('ul', { class: 'actions' }, ...r.action_items.map((a) => el('li', { class: 'small' }, a))),
    );
    list.appendChild(item);
  }
}

async function renderAllRuns() {
  app.innerHTML = '';
  app.appendChild(tpl('tpl-runs-all'));
  const { runs } = await api.get('/api/runs/list');
  const tbody = $('.rows');
  if (!runs.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No runs yet.</td></tr>`;
    return;
  }
  for (const r of runs) {
    tbody.appendChild(el('tr', { class: 'clickable', onclick: () => location.hash = `#/d/${r.domain_id}/runs` },
      el('td', {}, `#${r.id}`),
      el('td', {}, r.domain),
      el('td', {}, fmtDate(r.started_at)),
      el('td', {}, el('span', { class: 'badge ' + (r.status === 'completed' ? 'green' : r.status === 'failed' ? 'red' : 'yellow') }, r.status)),
      el('td', {}, `${r.prompts_done}/${r.prompts_total}`),
    ));
  }
}

async function renderSettings() {
  app.innerHTML = '';
  app.appendChild(tpl('tpl-settings'));
  const { settings } = await api.get('/api/settings');
  $('#serpapi-key').placeholder = settings.config.serpapi_key ? `current: ${settings.config.serpapi_key}` : 'SERPAPI_KEY';
  $('#track-cron').value = settings.config.track_cron || '0 6 * * *';

  $('#save-serpapi').addEventListener('click', async () => {
    const key = $('#serpapi-key').value.trim();
    if (!key) return;
    try {
      await api.post('/api/settings', { serpapi_key: key });
      toast('Saved', 'success');
      $('#serpapi-key').value = '';
      navigate();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#test-serpapi').addEventListener('click', async () => {
    const r = await api.post('/api/settings/test-serpapi', {});
    const status = $('#serpapi-status');
    status.textContent = r.ok ? 'OK - key works' : `Failed: ${r.error}`;
    status.style.color = r.ok ? 'green' : 'red';
  });
  $('#save-cron').addEventListener('click', async () => {
    const cron = $('#track-cron').value.trim();
    if (!cron) return;
    try {
      await api.post('/api/settings', { track_cron: cron });
      toast('Saved (restart server for cron change to take effect)', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  const toggles = $('.engine-toggles');
  const engines = await api.get('/api/engines');
  for (const e of engines.engines) {
    const on = !!settings.config.engines?.[e.key];
    const t = el('div', { class: 'engine-toggle ' + (on ? 'on' : ''), onclick: async () => {
      const cur = settings.config.engines || {};
      const next = { ...cur, [e.key]: !cur[e.key] };
      try {
        await api.post('/api/settings', { engines: next });
        navigate();
      } catch (err) { toast(err.message, 'error'); }
    }},
      el('span', { class: 'dot' }),
      e.label,
      e.requiresAuth ? el('span', { class: 'tag' }, 'login') : null,
    );
    toggles.appendChild(t);
  }
}
