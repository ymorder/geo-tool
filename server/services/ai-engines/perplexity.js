'use strict';

const { launchBrowser, newPageWithSession, makeResult, isHostOf } = require('./base');

const ORIGIN = 'https://www.perplexity.ai';

async function query({ prompt, targetDomain, timeoutMs = 90000 }) {
  const browser = await launchBrowser();
  let result;
  try {
    const { page } = await newPageWithSession(browser, 'perplexity', ORIGIN);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Find textarea/input
    const textarea = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 20000 });
    await textarea.fill(prompt);
    await textarea.press('Enter');

    // Wait for response to appear - watch for new footer/sources element
    await page.waitForTimeout(2500);
    await page.waitForFunction(
      () => {
        const root = document.body.innerText || '';
        // crude: look for any "Sources" or "Cited" footer text, or longer text
        return /sources|cited/i.test(root);
      },
      { timeout: timeoutMs }
    ).catch(() => {});

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

module.exports = { key: 'perplexity', label: 'Perplexity', origin: ORIGIN, query };
