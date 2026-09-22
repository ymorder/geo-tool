'use strict';

const { launchBrowser, newPageWithSession, makeResult, isHostOf, getSessionCookies } = require('./base');

const ORIGIN = 'https://grok.com';

// Grok requires X (Twitter) session cookies. Capture from grok.com after sign-in.
async function query({ prompt, targetDomain, timeoutMs = 90000 }) {
  const cookies = getSessionCookies('grok');
  if (!cookies.length) {
    return makeResult({
      ok: false,
      status: 'auth_required',
      error: 'GROK_SESSION cookies missing. Add them to .env to enable Grok tracking.',
    });
  }

  const browser = await launchBrowser();
  let result;
  try {
    const { page } = await newPageWithSession(browser, 'grok', ORIGIN);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const input = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 25000 });
    await input.fill(prompt);
    await input.press('Enter');

    let lastLength = 0;
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await page.waitForTimeout(1500);
      const len = await page.evaluate(() => (document.body.innerText || '').length);
      if (len === lastLength) {
        stable += 1;
        if (stable >= 3 && len > 200) break;
      } else {
        stable = 0;
        lastLength = len;
      }
    }

    const data = await page.evaluate(() => {
      const citeLinks = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.href)
        .filter((href) => /^https?:\/\//.test(href));
      const text = document.body.innerText || '';
      return { citeLinks, text };
    });

    const sources = Array.from(new Set(data.citeLinks));
    const myCitation = sources.find((s) => isHostOf(s, targetDomain));
    const excerpt = data.text.slice(0, 4000);

    result = makeResult({
      ok: true,
      status: 'ok',
      cited: !!myCitation,
      citationUrl: myCitation || null,
      sources,
      excerpt,
      rawResponse: data.text.slice(0, 30000),
    });
  } catch (err) {
    result = makeResult({ ok: false, status: 'error', error: err.message });
  } finally {
    try { await browser.close(); } catch {}
  }
  return result;
}

module.exports = { key: 'grok', label: 'Grok', origin: ORIGIN, query, requiresAuth: true };
