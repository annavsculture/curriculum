/**
 * api/proxy.js — Vercel Edge Function
 *
 * Proxies requests to curriculum.nsw.edu.au, stripping CORS headers
 * so the browser can fetch content from the client side.
 *
 * Usage: GET /api/proxy?url=https%3A%2F%2Fcurriculum.nsw.edu.au%2F...
 */

export const config = {
  runtime: 'edge',
};

const ALLOWED_HOST = 'curriculum.nsw.edu.au';

// Simple in-memory cache using the Cache API (available in edge runtime)
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (parsed.hostname !== ALLOWED_HOST) {
    return new Response(
      JSON.stringify({ error: `Only ${ALLOWED_HOST} is allowed` }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Cache check ───────────────────────────────────────────────────────────
  const cache = await caches.open('nsw-curriculum');
  const cacheKey = new Request(targetUrl);
  const cached = await cache.match(cacheKey);

  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: buildCorsHeaders('text/html; charset=utf-8'),
    });
  }

  // ── Upstream fetch ────────────────────────────────────────────────────────
  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NSW-Curriculum-Explorer/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream fetch failed', detail: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Upstream returned ${upstream.status}` }),
      { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await upstream.text();

  // ── Store in cache ────────────────────────────────────────────────────────
  const responseToCache = new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  await cache.put(cacheKey, responseToCache);

  // ── Respond ───────────────────────────────────────────────────────────────
  return new Response(body, {
    status: 200,
    headers: buildCorsHeaders('text/html; charset=utf-8'),
  });
}

function buildCorsHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
  };
}
