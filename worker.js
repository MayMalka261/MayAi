/**
 * Cloudflare Worker — MayAi Worker
 *
 * Hides the real Make.com webhook and Google Apps Script URLs.
 * Set these two secrets in the Cloudflare dashboard (Workers → Settings → Variables):
 *   MAKE_WEBHOOK_URL   — your full Make.com hook URL
 *   GOOGLE_SCRIPT_URL  — your full Google Apps Script exec URL
 *
 * Routes:
 *   POST /chat  → Make.com webhook (chat widget)
 *   POST /form  → Google Apps Script (lead form)
 */

const ALLOWED_ORIGIN = 'https://maymalka261.github.io';

// In-memory rate limiter: max 10 requests per IP per 60 seconds
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) return true;
  return false;
}

function corsHeaders(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse(body, status, origin, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders(origin), ...extraHeaders },
  });
}

async function handleChat(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse('Bad request', 400, origin); }

  const message = (body.message ?? '').toString().trim().slice(0, 500);
  const sessionId = (body.sessionId ?? '').toString().slice(0, 64);

  if (!message) return corsResponse('Empty message', 400, origin);

  const upstream = await fetch(env.MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!upstream.ok) return corsResponse('Upstream error', 502, origin);

  const reply = await upstream.text();
  return corsResponse(reply || 'קיבלתי, תודה!', 200, origin, { 'Content-Type': 'text/plain;charset=UTF-8' });
}

async function handleForm(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return corsResponse('Bad request', 400, origin); }

  const name  = (body.name  ?? '').toString().trim().slice(0, 100);
  const phone = (body.phone ?? '').toString().trim().slice(0, 20);
  if (!name || !phone) return corsResponse('Missing required fields', 400, origin);

  const params = new URLSearchParams({
    name,
    phone,
    email:     (body.email    ?? '').toString().trim().slice(0, 100),
    subject:   (body.subject  ?? '').toString().trim().slice(0, 100),
    problems:  (body.problems ?? '').toString().slice(0, 200),
    time:      (body.time     ?? '').toString().slice(0, 50),
    day:       (body.day      ?? '').toString().slice(0, 20),
    notes:     (body.notes    ?? '').toString().trim().slice(0, 1000),
    timestamp: new Date().toISOString(),
  });

  await fetch(env.GOOGLE_SCRIPT_URL + '?' + params.toString());

  return corsResponse('ok', 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (isRateLimited(ip)) {
      return new Response('Too many requests', { status: 429 });
    }

    if (pathname === '/chat') return handleChat(request, env, origin);
    if (pathname === '/form') return handleForm(request, env, origin);

    return new Response('Not found', { status: 404 });
  },
};
