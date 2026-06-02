const WORKER_PUBLIC_BASE = 'https://spelling-bee-api.sbsolver.workers.dev';
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

function sanitizeSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const slug = sanitizeSlug(params.slug);
  if (!slug) {
    return new Response('Invalid archive slug.', {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  let upstreamResponse;

  // Prefer Service Binding (zero-latency, same datacenter, no external HTTP)
  if (env.SPELLING_BEE_API) {
    const req = new Request(`https://internal/api/public/archive/slug/${encodeURIComponent(slug)}/html`);
    upstreamResponse = await env.SPELLING_BEE_API.fetch(req);
  } else {
    // Fallback: external HTTP request to the public worker
    const workerBase = env.WORKER_PUBLIC_API_BASE || WORKER_PUBLIC_BASE;
    const upstreamUrl = new URL(`/api/public/archive/slug/${encodeURIComponent(slug)}/html`, workerBase);
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.set('Cache-Control', CACHE_CONTROL);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.delete('set-cookie');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers,
  });
}
