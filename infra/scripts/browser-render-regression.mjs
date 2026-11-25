'use strict';

/*
 * Browser regression check for stale asynchronous renders.
 *
 * It opens the site, delays the first /api/drives response, navigates to the
 * login route before that response arrives, then verifies that the old render
 * did not overwrite the new screen with a null-element TypeError.
 *
 * The check needs a local Chrome/Chromium installation. Set CHROME_PATH and
 * BDO_TEST_URL to override the defaults. No credential is read or written.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = process.env.BDO_TEST_URL || 'https://bdo-organizer.bdo-organizer.workers.dev/#/';
const delayMs = Number(process.env.BDO_API_DELAY_MS || 2500);
const chromeCandidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];
const chrome = chromeCandidates.find((candidate) => candidate && fs.existsSync(candidate));
if (!chrome) {
  console.error('Chrome/Chromium not found. Set CHROME_PATH to the browser executable.');
  process.exit(1);
}

const port = 9300 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `bdo-browser-regression-${process.pid}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const child = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*', 'about:blank'
], { stdio: 'ignore' });

let ws;
let nextId = 1;
const pending = new Map();
const exceptions = [];

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return response.json();
    } catch { /* browser still starting */ }
    await wait(100);
  }
  throw new Error('Chrome debug endpoint did not start');
}

function stopBrowser() {
  try { if (ws) ws.close(); } catch { /* already closed */ }
  try { child.kill(); } catch { /* already stopped */ }
}

(async () => {
  const targets = await waitForEndpoint();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No Chrome page target was available');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      exceptions.push(detail.exception?.description || detail.text);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const target = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (target && target.includes('/api/drives')) {
          await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
        }
        return originalFetch(...args);
      };
    `
  });
  await send('Page.navigate', { url });
  await wait(900);
  await send('Runtime.evaluate', { expression: "location.hash = '#/login'" });
  await wait(delayMs + 1700);

  const dom = await send('Runtime.evaluate', {
    expression: "document.getElementById('app').textContent",
    returnByValue: true
  });
  const text = String(dom.result.value || '');
  const nullError = /Cannot set properties of null \(setting 'innerHTML'\)/.test(text);
  const loginVisible = text.includes('Welcome back');
  const passed = !nullError && loginVisible && exceptions.length === 0;

  const lines = [
    `Captured: ${new Date().toISOString()}`,
    `URL: ${url}`,
    `Method: delay /api/drives by ${delayMs}ms, then navigate from #/ to #/login before the response arrives`,
    `Result: ${passed ? 'PASS' : 'FAIL'}`,
    `Login screen rendered after stale response: ${loginVisible ? 'YES' : 'NO'}`,
    `Null innerHTML error rendered: ${nullError ? 'YES' : 'NO'}`,
    `Uncaught runtime exceptions: ${exceptions.length}`
  ];
  if (!passed && exceptions.length) lines.push('', ...exceptions.map((item) => item.split('\n')[0]));

  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  const evidence = path.join(root, 'evidence', 'BROWSER-RENDER-REGRESSION.txt');
  fs.writeFileSync(evidence, `${lines.join('\n')}\n`);
  console.log(`BROWSER RENDER REGRESSION: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`WROTE evidence/${path.basename(evidence)}`);
  if (!passed) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => {
  stopBrowser();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
});
