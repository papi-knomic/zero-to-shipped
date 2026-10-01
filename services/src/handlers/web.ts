import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { instrument, logger } from '../lib/observability.ts';

// Serves the built web app (bundled into this function's zip as ./static) from the HTTP API,
// the fallback while CloudFront is unavailable. It mirrors the CloudFront setup:
//   /                       → index.html (static landing page)
//   other extension-less    → app.html (React demo: /app, /documents/<id>)
//   files                   → the file, or 404 (never HTML with a 200 for a missing asset)
//   /api/* not routed       → JSON 404

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};
const TEXT = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    // Presigned uploads go straight to the S3 uploads bucket.
    "connect-src 'self' https://*.amazonaws.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

interface StaticFile {
  body: string;
  isBase64Encoded: boolean;
  contentType: string;
}

/** Loads every file once per container. The whole build is a few hundred KB. */
function loadStatic(dir: string, files = new Map<string, StaticFile>()): Map<string, StaticFile> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      loadStatic(full, files);
      continue;
    }
    const contentType = TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
    const isText = TEXT.test(contentType);
    const data = readFileSync(full);
    files.set('/' + relative(STATIC_DIR, full).split(sep).join('/'), {
      body: isText ? data.toString('utf8') : data.toString('base64'),
      isBase64Encoded: !isText,
      contentType,
    });
  }
  return files;
}

const files = loadStatic(STATIC_DIR);

function respond(status: number, file: StaticFile, cacheControl: string, head: boolean): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': file.contentType, 'cache-control': cacheControl, ...SECURITY_HEADERS },
    body: head ? '' : file.body,
    isBase64Encoded: head ? false : file.isBase64Encoded,
  };
}

function notFound(contentType: string, body: string): APIGatewayProxyStructuredResultV2 {
  return { statusCode: 404, headers: { 'content-type': contentType, 'cache-control': 'no-store', ...SECURITY_HEADERS }, body };
}

export const handler = instrument(async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method;
  let path: string;
  try {
    path = decodeURIComponent(event.rawPath || '/');
  } catch {
    return { statusCode: 400, headers: SECURITY_HEADERS, body: 'Bad request' };
  }

  if (path === '/api' || path.startsWith('/api/')) {
    return notFound('application/json', JSON.stringify({ error: 'Not found' }));
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return { statusCode: 405, headers: { allow: 'GET, HEAD', ...SECURITY_HEADERS }, body: '' };
  }
  const head = method === 'HEAD';

  // Paths are looked up in the in-memory map, never on disk, so ../ traversal can't escape.
  const file = files.get(path);
  if (file) {
    const immutable = path.startsWith('/assets/'); // content-hashed by Vite
    return respond(200, file, immutable ? 'public, max-age=31536000, immutable' : 'no-cache', head);
  }

  const lastSegment = path.split('/').pop() ?? '';
  if (lastSegment.includes('.')) {
    logger.info('static file not found', { path });
    return notFound('text/plain; charset=utf-8', 'Not found');
  }

  const page = path === '/' ? files.get('/index.html') : files.get('/app.html');
  if (!page) throw new Error('web build missing index.html/app.html');
  return respond(200, page, 'no-cache', head);
});
