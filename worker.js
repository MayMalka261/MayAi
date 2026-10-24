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

const ALLOWED_ORIGINS = [
  'https://maymalka261.github.io',
  'https://mayai-il.vercel.app',
];

// In-memory rate limiter: max 10 requests per IP per 60 seconds
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 8_192;

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
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

// Reads a JSON body only if it is JSON and small enough; returns null otherwise
async function readJson(request) {
  const type = request.headers.get('Content-Type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return null;
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

// Strips control characters and blocks spreadsheet formula injection (=, +, -, @)
function clean(value, max) {
  const text = (value ?? '').toString().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function corsResponse(body, status, origin, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders(origin), ...extraHeaders },
  });
}

async function handleChat(request, env, origin) {
  const body = await readJson(request);
  if (!body) return corsResponse('Bad request', 400, origin);

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
  const body = await readJson(request);
  if (!body) return corsResponse('Bad request', 400, origin);

  // Honeypot: bots fill the hidden "website" field — pretend success, store nothing
  if (body.website) return corsResponse('ok', 200, origin);

  const name  = clean(body.name, 100);
  const phone = (body.phone ?? '').toString().replace(/[^\d+\-() ]/g, '').trim().slice(0, 20);
  if (!name || phone.replace(/\D/g, '').length < 6) return corsResponse('Missing required fields', 400, origin);

  const params = new URLSearchParams({
    name,
    phone,
    email:     clean(body.email, 100),
    subject:   clean(body.subject, 100),
    problems:  clean(body.problems, 200),
    time:      clean(body.time, 50),
    day:       clean(body.day, 20),
    notes:     clean(body.notes, 1000),
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

    // Only the site itself may post — blocks other websites and casual direct abuse
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (isRateLimited(ip)) {
      return new Response('Too many requests', { status: 429 });
    }

    if (pathname === '/chat') return handleChat(request, env, origin);
    if (pathname === '/form') return handleForm(request, env, origin);

    return new Response('Not found', { status: 404 });
  },
};
