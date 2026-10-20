// Small local harness for the static page and Node-style Vercel handler.
// Vercel itself performs routing and function execution after deployment.
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const health = require('../api/health');
const { sendJson } = require('../lib/http');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/health') return health(req, res);
    if (pathname !== '/' && pathname !== '/weekend-escape.html') {
      return sendJson(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    const page = await readFile(path.join(root, 'weekend-escape.html'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : page);
  } catch {
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.on('error', () => {
  console.error('Unable to start development server. Check PORT and whether it is in use.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Weekend Escape local server listening on port ${port}`);
});
