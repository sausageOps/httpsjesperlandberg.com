/**
 * Static file server for the captured Jesper Landberg site.
 *
 * Security model:
 *   - A single canonical public root (PUBLIC_ROOT) is the only readable location.
 *   - Every request is decoded, normalised and resolved to an absolute real path.
 *   - The resolved real path must be inside the canonical public root (prefix check
 *     on path boundaries, after realpath() so symlinks cannot escape).
 *   - Directory listing is impossible; only files are served.
 *   - Unknown routes and missing assets return a genuine 404, never the homepage.
 *
 * Routes are static (pre-rendered), so no SPA fallback is required. Requests that do
 * not map to a real file are rejected.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Canonical public root. Only this directory may ever be read from.
const PUBLIC_ROOT = fs.realpathSync(path.join(__dirname, 'site_build'));

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.map': 'application/json; charset=UTF-8',
  '.txt': 'text/plain; charset=UTF-8',
  '.xml': 'application/xml; charset=UTF-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2'
};

// Requests for these methods are served; anything else is rejected.
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

// Paths that are never served, even if they exist inside the public root.
const DENIED_BASENAMES = new Set([
  '.git', '.gitignore', '.env', '.npmrc', '.netrc',
  'server.js', 'package.json', 'package-lock.json',
  'yarn.lock', 'pnpm-lock.yaml'
]);

/**
 * True when `candidate` is inside `root` (both absolute, normalised).
 * Uses a path-separator boundary check so "/site_build_evil" does not match "/site_build".
 */
function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Decode and normalise a raw URL pathname.
 * Rejects NUL bytes, control characters, backslash traversal and over-long paths.
 */
function normalisePathname(rawPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    return null; // malformed percent-encoding
  }

  if (!decoded || decoded.length > 2048) return null;
  if (decoded.includes('\0')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0001-\u001f]/.test(decoded)) return null;

  // Treat backslashes as path separators so Windows-style traversal is caught too.
  const unified = decoded.replace(/\\/g, '/');

  // Collapse duplicate slashes.
  return unified.replace(/\/{2,}/g, '/');
}

/**
 * Resolve a request pathname to a real file path inside PUBLIC_ROOT.
 * Returns { path } on success, or { error } with an HTTP status.
 */
function resolveRequest(rawPathname) {
  const pathname = normalisePathname(rawPathname);
  if (pathname === null) return { error: 400 };

  // Deny hidden files/dirs and private project files anywhere in the path.
  const segments = pathname.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment.startsWith('.')) return { error: 403 };
    if (DENIED_BASENAMES.has(segment.toLowerCase())) return { error: 403 };
  }

  // Join against the canonical root and resolve to an absolute path.
  const joined = path.resolve(PUBLIC_ROOT, '.' + pathname);

  // First containment check (lexical, before touching the filesystem).
  if (!isInside(PUBLIC_ROOT, joined)) return { error: 403 };

  let stat;
  try {
    stat = fs.statSync(joined);
  } catch {
    return { error: 404 };
  }

  // Directories: serve their index.html when present, never a listing.
  let filePath = joined;
  if (stat.isDirectory()) {
    const indexPath = path.join(joined, 'index.html');
    let indexStat;
    try {
      indexStat = fs.statSync(indexPath);
    } catch {
      return { error: 404 };
    }
    if (!indexStat.isFile()) return { error: 404 };
    filePath = indexPath;
  } else if (!stat.isFile()) {
    // Sockets, FIFOs, devices, etc.
    return { error: 404 };
  }

  // Second containment check on the REAL path, so a symlink inside the public
  // root that points outside cannot be used to read private files.
  let realPath;
  try {
    realPath = fs.realpathSync(filePath);
  } catch {
    return { error: 404 };
  }
  if (!isInside(PUBLIC_ROOT, realPath)) return { error: 403 };

  return { path: realPath };
}

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

const NOT_FOUND_BODY = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 — Not found</title>
<style>html,body{height:100%;margin:0;background:#000;color:#fff;font-family:ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center}div{text-align:center}h1{font-size:1.5rem;font-weight:500;margin:0 0 .5rem}p{margin:0;color:#888;font-size:.9rem}a{color:#fff}</style>
</head><body><div><h1>404</h1><p>This page does not exist. <a href="/">Return home</a></p></div></body></html>`;

const server = http.createServer((req, res) => {
  if (!ALLOWED_METHODS.has(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=UTF-8' });
    return;
  }

  // CORS is not required for a same-origin static site, but keep it permissive
  // for the public assets so direct asset fetches keep working.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Assets are patched in place under content-hashed names, so any cached copy
  // is permanently stale. Force every hop (browser, preview proxy, CDN) to
  // revalidate so a deployed fix is actually what gets rendered.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Strip query string and fragment before resolving.
  const rawPathname = (req.url || '/').split('?')[0].split('#')[0];

  const resolved = resolveRequest(rawPathname);
  if (resolved.error) {
    const status = resolved.error;
    const body = status === 404 ? NOT_FOUND_BODY : 'Forbidden';
    const type = status === 404 ? 'text/html; charset=UTF-8' : 'text/plain; charset=UTF-8';
    send(res, status, body, { 'Content-Type': type });
    return;
  }

  const ext = path.extname(resolved.path).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(resolved.path, (err, content) => {
    if (err) {
      send(res, 404, NOT_FOUND_BODY, { 'Content-Type': 'text/html; charset=UTF-8' });
      return;
    }
    const headers = { 'Content-Type': contentType, 'Content-Length': content.length };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(content);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT} (public root: ${PUBLIC_ROOT})`);
});
