'use strict';

const { launchBrowser, newPageWithSession, makeResult, isHostOf, getSessionCookies } = require('./base');

const ORIGIN = 'https://gemini.google.com';

// Gemini requires Google session cookies. Capture them from gemini.google.com
// after signing in (DevTools > Application > Cookies). Pass them as
// GEMINI_SESSION in .env, either as JSON array or "name=value; name=value" form.
async function query({ prompt, targetDomain, timeoutMs = 90000 }) {
  const cookies = getSessionCookies('gemini');
  if (!cookies.length) {
    return makeResult({
      ok: false,
      status: 'auth_required',
      error: 'GEMINI_SESSION cookies missing. Add them to .env to enable Gemini tracking.',
    });
  }

  const browser = await launchBrowser();
  let result;
  try {
    const { page } = await newPageWithSession(browser, 'gemini', ORIGIN);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const input = await page.waitForSelector('div[contenteditable="true"], textarea, rich-textarea', { timeout: 25000 });
    await input.click();
    await page.keyboard.type(prompt, { delay: 10 });
    await page.keyboard.press('Enter');

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

module.exports = { key: 'gemini', label: 'Google Gemini', origin: ORIGIN, query, requiresAuth: true };
