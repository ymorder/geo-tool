'use strict';

const serp = require('./serp');

const engines = {
  google: {
    key: 'google',
    label: 'Google',
    origin: 'https://www.google.com',
    query: serp.googleQuery,
    isAi: false,
  },
  bing: {
    key: 'bing',
    label: 'Bing',
    origin: 'https://www.bing.com',
    query: serp.bingQuery,
    isAi: false,
  },
  perplexity: require('./perplexity'),
  copilot: require('./copilot'),
  you: require('./you'),
  deepseek: require('./deepseek'),
  gemini: require('./gemini'),
  chatgpt: require('./chatgpt'),
  claude: require('./claude'),
  grok: require('./grok'),
};

function list() {
  return Object.values(engines).map((e) => ({
    key: e.key,
    label: e.label,
    origin: e.origin,
    isAi: e.isAi === undefined ? true : !!e.isAi,
    requiresAuth: !!e.requiresAuth,
  }));
}

function get(key) {
  return engines[key] || null;
}

module.exports = { engines, list, get };
