#!/usr/bin/env node

// Submits every URL in the live sitemap to Bing IndexNow.
// Intended to run after a Cloudflare Pages deploy so search engines are
// notified about the freshly deployed pages.
//
// Usage: node scripts/ping-indexnow.mjs
//
// Env:
//   INDEXNOW_KEY  Required. Bing IndexNow key. The key file must be served at
//                 https://<host>/<key>.txt (the deploy workflow writes it into
//                 public/ before building).
//   SITE_URL      Optional. Defaults to https://spellingbeesolver.dev

const SITE_URL = (process.env.SITE_URL || 'https://spellingbeesolver.dev').replace(/\/+$/, '');
const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH_SIZE = 10000; // IndexNow allows up to 10,000 URLs per request
const SITEMAP_FETCH_ATTEMPTS = 3;
const SITEMAP_FETCH_RETRY_MS = 5000;

function log(...args) {
  console.log('[IndexNow]', ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSitemap() {
  let lastError;
  for (let attempt = 1; attempt <= SITEMAP_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(SITEMAP_URL);
      if (!response.ok) {
        throw new Error(`GET ${SITEMAP_URL} -> ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < SITEMAP_FETCH_ATTEMPTS) {
        log(`Sitemap fetch attempt ${attempt} of ${SITEMAP_FETCH_ATTEMPTS} failed (${error.message}); retrying in ${SITEMAP_FETCH_RETRY_MS / 1000}s...`);
        await sleep(SITEMAP_FETCH_RETRY_MS);
      }
    }
  }
  throw lastError;
}

function extractUrls(xml) {
  const urls = [];
  const locRegex = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = (match[1] || '').trim();
    if (/^https?:\/\//i.test(url)) {
      urls.push(url);
    }
  }
  return [...new Set(urls)];
}

async function submitBatch(host, key, keyLocation, urls) {
  return fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
  });
}

async function main() {
  const key = process.env.INDEXNOW_KEY;
  if (!key) {
    console.error('::error::Missing INDEXNOW_KEY environment variable. Add INDEXNOW_KEY to the workflow env or repository secrets.');
    process.exit(1);
  }

  const host = new URL(SITE_URL).host;
  const keyLocation = `${SITE_URL}/${key}.txt`;

  log(`Fetching sitemap: ${SITEMAP_URL}`);
  const xml = await fetchSitemap();
  const urls = extractUrls(xml);

  if (urls.length === 0) {
    log('No URLs found in sitemap; nothing to submit.');
    return;
  }

  log(`Found ${urls.length} URL(s) in sitemap. Submitting to ${INDEXNOW_ENDPOINT} (host=${host}, keyLocation=${keyLocation})`);

  let failures = 0;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    try {
      const response = await submitBatch(host, key, keyLocation, batch);
      if (response.ok) {
        log(`Batch ${batchNumber} submitted (${batch.length} URLs) -> HTTP ${response.status}`);
      } else {
        failures += 1;
        const body = await response.text().catch(() => '');
        console.error(`::error::IndexNow rejected batch ${batchNumber} (${batch.length} URLs): HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
      }
    } catch (error) {
      failures += 1;
      console.error(`::error::IndexNow request failed for batch ${batchNumber} (${batch.length} URLs): ${error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`::error::${failures} of ${Math.ceil(urls.length / BATCH_SIZE)} IndexNow batch(es) failed.`);
    process.exit(1);
  }

  log(`All ${urls.length} URL(s) submitted to Bing IndexNow for ${SITE_URL}.`);
}

main().catch((error) => {
  console.error(`::error::IndexNow ping failed: ${error.message}`);
  process.exit(1);
});
