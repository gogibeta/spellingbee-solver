const WORKER_PUBLIC_BASE = 'https://spelling-bee-api.sbsolver.workers.dev';
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

function sanitizeWord(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const word = sanitizeWord(params.word);
  if (!word || word.length < 2 || word.length > 30) {
    return new Response(JSON.stringify({ success: false, error: 'Word must be 2–30 letters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  let upstreamResponse;

  // Prefer Service Binding (zero-latency, same datacenter, no external HTTP)
  if (env.SPELLING_BEE_API) {
    const req = new Request(`https://internal/api/search/word/${encodeURIComponent(word)}`);
    upstreamResponse = await env.SPELLING_BEE_API.fetch(req);
  } else {
    // Fallback: external HTTP request to the public worker
    const workerBase = env.WORKER_PUBLIC_API_BASE || WORKER_PUBLIC_BASE;
    const upstreamUrl = new URL(`/api/search/word/${encodeURIComponent(word)}`, workerBase);
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      cf: { cacheEverything: true, cacheTtl: 3600 },
    });
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.set('Cache-Control', CACHE_CONTROL);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.delete('set-cookie');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}
