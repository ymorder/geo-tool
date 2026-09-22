'use strict';

const { launchBrowser, newPageWithSession, makeResult, isHostOf } = require('./base');

const ORIGIN = 'https://chat.deepseek.com';

async function query({ prompt, targetDomain, timeoutMs = 90000 }) {
  const browser = await launchBrowser();
  let result;
  try {
    const { page } = await newPageWithSession(browser, 'deepseek', ORIGIN);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const textarea = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 20000 });
    await textarea.fill(prompt);
    await textarea.press('Enter');

    // DeepSeek produces streaming text; wait for the response to stabilise
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

module.exports = { key: 'deepseek', label: 'DeepSeek', origin: ORIGIN, query };
