'use strict';

const fs = require('fs');
const path = require('path');

// Lazy-load playwright so the server boots even before `npx playwright install`
let _playwright = null;
function getPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = require('playwright');
  } catch (err) {
    throw new Error(
      'playwright is not installed. Run `npm install` and `npx playwright install chromium`.'
    );
  }
  return _playwright;
}

function loadCookies(name) {
  const raw = process.env[name];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Allow simple name:value;name:value form
      const out = [];
      parsed.split(';').forEach((pair) => {
        const [k, ...rest] = pair.split('=');
        if (k && rest.length) out.push({ name: k.trim(), value: rest.join('=').trim() });
      });
      return out;
    }
    return parsed;
  } catch (err) {
    console.warn(`[ai-engine] could not parse ${name}:`, err.message);
    return [];
  }
}

function getSessionCookies(engineKey) {
  // Engine-specific env vars plus a generic fallback.
  const envMap = {
    chatgpt: 'CHATGPT_SESSION',
    gemini: 'GEMINI_SESSION',
    claude: 'CLAUDE_SESSION',
    grok: 'GROK_SESSION',
    copilot: 'COPILOT_SESSION',
    perplexity: 'PERPLEXITY_SESSION',
    you: 'YOU_SESSION',
    deepseek: 'DEEPSEEK_SESSION',
  };
  return loadCookies(envMap[engineKey] || '');
}

async function launchBrowser() {
  const playwright = getPlaywright();
  const headless = process.env.HEADLESS_BROWSER !== 'false';
  const browser = await playwright.chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  return browser;
}

async function newPageWithSession(browser, engineKey, origin) {
  const context = await browser.newContext({
    userAgent:
      process.env.BROWSER_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const cookies = getSessionCookies(engineKey);
  if (cookies.length) {
    try {
      await context.addCookies(
        cookies.map((c) => ({
          ...c,
          url: c.url || origin,
        }))
      );
    } catch (err) {
      console.warn(`[ai-engine:${engineKey}] failed to add cookies:`, err.message);
    }
  }
  const page = await context.newPage();
  return { context, page };
}

// Normalise a result shape so the runner can store uniformly.
function makeResult({ ok, status, cited, position = null, citationUrl = null, sources = [], rawResponse = null, excerpt = null, error = null }) {
  return {
    ok,
    status: status || (ok ? 'ok' : 'error'),
    cited: cited ? 1 : 0,
    position,
    citation_url: citationUrl,
    sources,
    raw_response: rawResponse,
    response_excerpt: excerpt,
    error,
  };
}

function isHostOf(url, targetDomain) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const target = targetDomain.toLowerCase().replace(/^www\./, '');
    return host === target || host.endsWith('.' + target);
  } catch {
    return false;
  }
}

module.exports = {
  getPlaywright,
  launchBrowser,
  newPageWithSession,
  makeResult,
  isHostOf,
  getSessionCookies,
};
