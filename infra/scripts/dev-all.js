'use strict';

// One command for local development: 3 Express services + static website.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const dbFile = path.join(root, '.data', 'bdo.sqlite');
const shared = {
  ...process.env,
  NODE_ENV: 'development',
  TEST_MODE: '1',
  EMAIL_MODE: 'log',
  DATA_DRIVER: 'sqlite',
  SQLITE_PATH: dbFile,
  JWT_SECRET: process.env.JWT_SECRET || 'local-dev-jwt-secret-change-in-production',
  INTERNAL_KEY: process.env.INTERNAL_KEY || 'local-dev-internal-key',
  ORGANIZER_INVITE: process.env.ORGANIZER_INVITE || 'blood2026',
  DRIVE_SERVICE_URL: 'http://localhost:3001',
  DONOR_SERVICE_URL: 'http://localhost:3002',
  BOOKING_SERVICE_URL: 'http://localhost:3003',
  CORS_ORIGINS: 'http://localhost:8090'
};

const children = [];
for (const [service, port] of [['drive', 3001], ['donor', 3002], ['booking', 3003]]) {
  const child = spawn(process.execPath, [path.join(root, 'services', service, 'server.js')], {
    cwd: root,
    env: { ...shared, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (data) => process.stdout.write(`[${service}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${service}:error] ${data}`));
  children.push(child);
}

const frontend = path.join(root, 'frontend');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  const requested = decodeURIComponent(req.url.split('?')[0]);
  const relative = requested === '/' ? '/index.html' : requested;
  const file = path.join(frontend, path.normalize(relative).replace(/^([/\\])+/, ''));
  if (!file.startsWith(frontend)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  });
}).listen(8090, () => {
  console.log('\nWebsite:   http://localhost:8090');
  console.log('Drive API: http://localhost:3001  |  Donor API: http://localhost:3002  |  Booking API: http://localhost:3003');
  console.log('Press Ctrl+C to stop everything.\n');
});

process.on('SIGINT', () => {
  children.forEach((child) => child.kill());
  process.exit(0);
});
