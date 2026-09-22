'use strict';

const { launchBrowser, newPageWithSession, makeResult, isHostOf } = require('./base');

const ORIGIN = 'https://copilot.microsoft.com';

async function query({ prompt, targetDomain, timeoutMs = 90000 }) {
  const browser = await launchBrowser();
  let result;
  try {
    const { page } = await newPageWithSession(browser, 'copilot', ORIGIN);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait for textarea
    const textarea = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 20000 });
    await textarea.fill(prompt);
    await textarea.press('Enter');

    // Wait for response - look for citation links
    await page.waitForFunction(
      () => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        return links.some((a) => /^https?:\/\//.test(a.href));
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

module.exports = { key: 'copilot', label: 'Microsoft Copilot', origin: ORIGIN, query };
