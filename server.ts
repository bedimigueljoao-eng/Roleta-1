import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

// In-memory session cookie jar keyed by rl_sid -> origin -> Map<name, value>
const sessionCookieJars = new Map<string, Map<string, Map<string, string>>>();
const MAX_SESSIONS = 300;

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'cookie',
  'origin',
  'referer',
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
]);

const ROLETA_OWN_PREFIXES = [
  '/roletalab-assets/',
  '/src/',
  '/@vite/',
  '/@react-refresh',
  '/@fs/',
  '/@id/',
  '/node_modules/',
  '/api/',
  '/browse/',
  '/workbox-',
];

const ROLETA_OWN_EXACT = new Set([
  '/',
  '/index.html',
  '/sw.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
]);

function isPrivateOrRestrictedIp(ip: string): boolean {
  const cleaned = ip.replace(/^::ffff:/i, '');
  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(cleaned)) {
    const lower = cleaned.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80:') || lower.startsWith('ff')) return true;
    return false;
  }

  return true;
}

async function validatePublicTargetUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Protocolo não permitido');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Credenciais no URL não são permitidas');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Destino interno bloqueado');
  }

  if (net.isIP(host)) {
    if (isPrivateOrRestrictedIp(host)) {
      throw new Error('IP privado ou reservado bloqueado');
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error('Host não resolvido');
  }
  for (const rec of records) {
    if (isPrivateOrRestrictedIp(rec.address)) {
      throw new Error('Endereço resolvido bloqueado');
    }
  }

  return parsed;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function getOrCreateSessionId(req: Request, res: Response): string {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies.rl_sid;
  if (!sid || !/^[a-f0-9]{24,64}$/i.test(sid)) {
    sid = crypto.randomBytes(24).toString('hex');
    const isHttps =
      req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cookieParts = [
      `rl_sid=${sid}`,
      'Path=/',
      'HttpOnly',
      isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
    ];
    res.append('Set-Cookie', cookieParts.join('; '));
  }
  if (!sessionCookieJars.has(sid)) {
    if (sessionCookieJars.size >= MAX_SESSIONS) {
      const oldestKey = sessionCookieJars.keys().next().value;
      if (oldestKey) sessionCookieJars.delete(oldestKey);
    }
    sessionCookieJars.set(sid, new Map());
  }
  return sid;
}

function storeUpstreamCookies(
  sid: string,
  origin: string,
  setCookieHeaders: string[]
): void {
  if (setCookieHeaders.length === 0) return;
  let originMap = sessionCookieJars.get(sid);
  if (!originMap) {
    originMap = new Map();
    sessionCookieJars.set(sid, originMap);
  }
  let jar = originMap.get(origin);
  if (!jar) {
    jar = new Map();
    originMap.set(origin, jar);
  }
  for (const raw of setCookieHeaders) {
    const firstPair = raw.split(';')[0]?.trim();
    if (!firstPair) continue;
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPair.slice(0, eqIdx).trim();
    const val = firstPair.slice(eqIdx + 1).trim();
    if (val === '' || /max-age=0/i.test(raw)) {
      jar.delete(name);
    } else {
      jar.set(name, val);
    }
  }
}

function buildCookieHeader(sid: string, origin: string): string | null {
  const jar = sessionCookieJars.get(sid)?.get(origin);
  if (!jar || jar.size === 0) return null;
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function toProxyPath(target: URL): string {
  const proto = target.protocol.replace(':', '');
  return `/browse/${proto}/${target.host}${target.pathname}${target.search}`;
}

function buildShimScript(origin: string, proxyPrefix: string): string {
  const safeOrigin = JSON.stringify(origin);
  const safePrefix = JSON.stringify(proxyPrefix);
  return `<script data-roletalab-shim="1">
(function(){
  try {
    var TARGET_ORIGIN = ${safeOrigin};
    var PROXY_PREFIX = ${safePrefix};
    if (window.location.pathname.indexOf(PROXY_PREFIX) === 0) {
      var cleanPath = window.location.pathname.slice(PROXY_PREFIX.length) || '/';
      if (cleanPath.charAt(0) !== '/') cleanPath = '/' + cleanPath;
      try {
        window.history.replaceState(window.history.state, '', cleanPath + window.location.search + window.location.hash);
      } catch (e) {}
    }
    function rewriteUrl(u) {
      if (typeof u !== 'string') return u;
      if (u.indexOf('https://') === 0 || u.indexOf('http://') === 0) {
        try {
          var parsed = new URL(u);
          if (parsed.origin === TARGET_ORIGIN) {
            return parsed.pathname + parsed.search + parsed.hash;
          }
          if (parsed.hostname.endsWith('kwanzabet.ao')) {
            return '/browse/' + parsed.protocol.replace(':', '') + '/' + parsed.host + parsed.pathname + parsed.search + parsed.hash;
          }
        } catch (e) {}
      }
      return u;
    }
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input, init) {
        if (typeof input === 'string') {
          input = rewriteUrl(input);
        }
        return origFetch.call(this, input, init);
      };
    }
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof url === 'string') {
        args[1] = rewriteUrl(url);
      }
      return origOpen.apply(this, args);
    };
    window.open = function(url) {
      if (typeof url === 'string' && /^https?:/i.test(url)) {
        try {
          var p = new URL(url);
          window.location.assign('/browse/' + p.protocol.replace(':', '') + '/' + p.host + p.pathname + p.search + p.hash);
        } catch (e) {}
      }
      return window;
    };
  } catch (err) {}
})();
</script>`;
}

function rewriteHtmlDocument(
  html: string,
  targetUrl: URL
): string {
  const proto = targetUrl.protocol.replace(':', '');
  const origin = targetUrl.origin;
  const proxyPrefix = `/browse/${proto}/${targetUrl.host}`;
  const shim = buildShimScript(origin, proxyPrefix);

  let out = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

  // Rewrite absolute URLs belonging to the target origin into root-relative URLs
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(escapedOrigin, 'g'), '');

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
  } else {
    out = `${shim}${out}`;
  }

  return out;
}

function rewriteCssUrls(css: string, targetUrl: URL): string {
  return css.replace(new RegExp(targetUrl.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
}

async function fetchWithSafeRedirects(
  initialUrl: URL,
  req: Request,
  sid: string
): Promise<{ response: globalThis.Response; finalUrl: URL }> {
  let currentUrl = initialUrl;
  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const rawBody: ArrayBuffer | string | undefined =
    hasBody && req.body !== undefined
      ? Buffer.isBuffer(req.body)
        ? req.body.length > 0
          ? (req.body.buffer.slice(
              req.body.byteOffset,
              req.body.byteOffset + req.body.byteLength
            ) as ArrayBuffer)
          : undefined
        : typeof req.body === 'string' && req.body.length > 0
        ? req.body
        : undefined
      : undefined;

  for (let hop = 0; hop < 6; hop++) {
    await validatePublicTargetUrl(currentUrl.toString());

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      const lower = k.toLowerCase();
      if (HOP_BY_HOP_REQUEST_HEADERS.has(lower) || lower.startsWith('sec-fetch-')) {
        continue;
      }
      if (typeof v === 'string') {
        headers.set(k, v);
      } else if (Array.isArray(v)) {
        headers.set(k, v.join(', '));
      }
    }

    if (!headers.has('user-agent')) {
      headers.set(
        'user-agent',
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
      );
    }
    headers.set('referer', `${currentUrl.origin}/`);
    headers.set('origin', currentUrl.origin);

    const jarCookie = buildCookieHeader(sid, currentUrl.origin);
    if (jarCookie) {
      headers.set('cookie', jarCookie);
    }

    const upstreamRes = await fetch(currentUrl.toString(), {
      method: hop === 0 ? method : 'GET',
      headers,
      body: hop === 0 ? rawBody : undefined,
      redirect: 'manual',
    });

    const getSetCookie = (upstreamRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = typeof getSetCookie === 'function' ? getSetCookie.call(upstreamRes.headers) : [];
    if (setCookies.length > 0) {
      storeUpstreamCookies(sid, currentUrl.origin, setCookies);
    }

    if (
      upstreamRes.status >= 300 &&
      upstreamRes.status < 400 &&
      upstreamRes.headers.has('location')
    ) {
      const loc = upstreamRes.headers.get('location')!;
      const nextUrl = new URL(loc, currentUrl);
      if (
        upstreamRes.headers.get('content-type')?.includes('text/html') ||
        req.headers['sec-fetch-dest'] === 'iframe'
      ) {
        currentUrl = nextUrl;
        continue;
      }
      return { response: upstreamRes, finalUrl: currentUrl };
    }

    return { response: upstreamRes, finalUrl: currentUrl };
  }

  throw new Error('Demasiados redirecionamentos');
}

async function handleProxyRequest(
  req: Request,
  res: Response,
  targetUrlString: string,
  setOriginCookie: boolean
): Promise<void> {
  try {
    const validatedUrl = await validatePublicTargetUrl(targetUrlString);
    const sid = getOrCreateSessionId(req, res);

    if (setOriginCookie) {
      const isHttps =
        req.secure || req.headers['x-forwarded-proto'] === 'https';
      const originCookie = [
        `rl_proxy_origin=${encodeURIComponent(validatedUrl.origin)}`,
        'Path=/',
        'HttpOnly',
        isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
      ].join('; ');
      res.append('Set-Cookie', originCookie);
    }

    const { response: upstreamRes, finalUrl } = await fetchWithSafeRedirects(
      validatedUrl,
      req,
      sid
    );

    if (
      upstreamRes.status >= 300 &&
      upstreamRes.status < 400 &&
      upstreamRes.headers.has('location')
    ) {
      const nextTarget = new URL(upstreamRes.headers.get('location')!, finalUrl);
      await validatePublicTargetUrl(nextTarget.toString());
      res.redirect(upstreamRes.status, toProxyPath(nextTarget));
      return;
    }

    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (STRIPPED_RESPONSE_HEADERS.has(lower) || lower === 'set-cookie') {
        return;
      }
      res.setHeader(key, value);
    });

    const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      const text = await upstreamRes.text();
      const rewritten = rewriteHtmlDocument(text, finalUrl);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.send(rewritten);
      return;
    }

    if (contentType.includes('text/css')) {
      const css = await upstreamRes.text();
      const rewrittenCss = rewriteCssUrls(css, finalUrl);
      res.setHeader('content-type', 'text/css; charset=utf-8');
      res.send(rewrittenCss);
      return;
    }

    const arrayBuf = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro no proxy';
    res.status(502).type('text/html').send(
      `<!doctype html><html lang="pt"><body style="background:#0B0F17;color:#E2E8F0;font-family:sans-serif;padding:24px;"><h3>Não foi possível carregar via proxy</h3><p style="color:#94A3B8;font-size:14px;">${message.replace(/[<>&]/g, '')}</p></body></html>`
    );
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.raw({ type: '*/*', limit: '5mb' }));

  app.get('/api/proxy-status', (_req, res) => {
    res.json({ enabled: true });
  });

  // Main path-based reverse proxy for embedded split-screen browser
  app.use('/browse/:proto/:host', async (req: Request, res: Response) => {
    const proto = req.params.proto;
    const host = req.params.host;
    if (proto !== 'http' && proto !== 'https') {
      res.status(400).send('Protocolo inválido');
      return;
    }
    const subPathAndQuery = req.originalUrl.replace(
      new RegExp(`^/browse/${proto}/${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      ''
    ) || '/';
    const normalizedPath = subPathAndQuery.startsWith('/') ? subPathAndQuery : `/${subPathAndQuery}`;
    const targetUrl = `${proto}://${host}${normalizedPath}`;
    await handleProxyRequest(req, res, targetUrl, true);
  });

  // Transparent sub-resource & SPA route proxy when running inside the embedded iframe
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const reqPath = req.path;
    if (
      ROLETA_OWN_EXACT.has(reqPath) ||
      ROLETA_OWN_PREFIXES.some((prefix) => reqPath.startsWith(prefix))
    ) {
      next();
      return;
    }

    const referer = req.headers.referer || '';
    const refMatch = referer.match(/\/browse\/(https?)\/([^/?#]+)/);
    const cookies = parseCookies(req.headers.cookie);
    const cookieOrigin = cookies.rl_proxy_origin
      ? decodeURIComponent(cookies.rl_proxy_origin)
      : null;

    let origin: string | null = null;
    if (refMatch) {
      origin = `${refMatch[1]}://${refMatch[2]}`;
    } else if (cookieOrigin && req.headers['sec-fetch-dest'] !== 'document') {
      origin = cookieOrigin;
    }

    if (!origin) {
      next();
      return;
    }

    await handleProxyRequest(req, res, `${origin}${req.originalUrl}`, false);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build dist/ não encontrado.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RoletaLab server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
