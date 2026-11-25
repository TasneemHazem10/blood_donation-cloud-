'use strict';

// One command for local development: 3 Express services + static website.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
// Lab 8 horizontal scaling starts several independent stacks. The ports are
// configurable so each replica owns its own ports and SQLite database.
const replica = Number(process.env.BDO_REPLICA || 0);
const offset = replica * 100;
const drivePort = Number(process.env.DRIVE_PORT || 3001 + offset);
const donorPort = Number(process.env.DONOR_PORT || 3002 + offset);
const bookingPort = Number(process.env.BOOKING_PORT || 3003 + offset);
const webPort = Number(process.env.WEB_PORT || 8090 + offset);
const dbFile = path.join(root, '.data', replica === 0 ? 'bdo.sqlite' : `bdo-replica-${replica}.sqlite`);
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
  DRIVE_SERVICE_URL: `http://localhost:${drivePort}`,
  DONOR_SERVICE_URL: `http://localhost:${donorPort}`,
  BOOKING_SERVICE_URL: `http://localhost:${bookingPort}`,
  CORS_ORIGINS: `http://localhost:${webPort}`
};

const children = [];
for (const [service, port] of [['drive', drivePort], ['donor', donorPort], ['booking', bookingPort]]) {
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
}).listen(webPort, () => {
  console.log(`\nWebsite:   http://localhost:${webPort}`);
  console.log(`Drive API: http://localhost:${drivePort}  |  Donor API: http://localhost:${donorPort}  |  Booking API: http://localhost:${bookingPort}`);
  console.log('Press Ctrl+C to stop everything.\n');
});

function shutdown() {
  children.forEach((child) => child.kill());
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
