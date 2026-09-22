'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { classify } = require('./categorize-taxonomy');

async function fetchSiteText(domain) {
  const url = `https://${domain}`;
  const res = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      'User-Agent':
        process.env.BROWSER_USER_AGENT ||
        'Mozilla/5.0 (compatible; GeoToolBot/0.1; +https://example.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const html = res.data;
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, noscript, iframe, svg, canvas, img, video, audio').remove();
  const title = $('title').first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const ogTitle =
    $('meta[property="og:title"]').attr('content') || '';
  const h1 = $('h1')
    .map((i, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 5)
    .join(' | ');
  const h2 = $('h2')
    .map((i, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 10)
    .join(' | ');
  // Visible body text
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20000);
  // Schema.org type hints
  const schemaTypes = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type']) {
          schemaTypes.push(String(item['@type']));
        }
      }
    } catch {
      // ignore parse errors
    }
  });

  const combined = [title, ogTitle, metaDescription, h1, h2, bodyText]
    .filter(Boolean)
    .join('\n\n');

  return {
    url,
    finalUrl: res.request?.res?.responseUrl || url,
    title,
    metaDescription,
    h1,
    h2,
    schemaTypes,
    bodyText: combined,
  };
}

async function categorize(domain) {
  let fetched = null;
  let fetchError = null;
  try {
    fetched = await fetchSiteText(domain);
  } catch (err) {
    fetchError = err.message;
  }

  if (!fetched) {
    return {
      category: null,
      category_sub: null,
      confidence: 0,
      signals: [],
      error: fetchError || 'fetch_failed',
    };
  }

  const text = `${fetched.title}\n${fetched.metaDescription}\n${fetched.h1}\n${fetched.h2}\n${fetched.bodyText}`;
  const result = classify(text);

  return {
    category: result.category,
    category_id: result.category_id,
    category_sub: result.category_sub,
    confidence: result.confidence,
    signals: result.signals,
    runner_up: result.runner_up,
    schema_types: fetched.schemaTypes,
    title: fetched.title,
    meta_description: fetched.metaDescription,
    h1: fetched.h1,
    fetched_url: fetched.finalUrl,
  };
}

module.exports = { categorize, fetchSiteText };
