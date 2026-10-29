import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(os.tmpdir(), 'jarvis-frozen-'));
const child = spawn(path.resolve('dist/jarvis-core/jarvis-core.exe'), [], { stdio: 'pipe', windowsHide: true });
let errors = '';
child.stderr.on('data', data => { errors += data.toString(); });
const token = randomBytes(32).toString('hex');
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Frozen Core startup timeout')), 45000);
  createInterface({ input: child.stdout }).on('line', line => {
    try { const message = JSON.parse(line); if (message.ready) { clearTimeout(timer); resolve(message.port); } } catch {}
  });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Frozen Core exited ${code}: ${errors.slice(-1000)}`)); });
});
child.stdin.write(JSON.stringify({ token, directory, keys: {} }) + '\n');
try {
  const port = await ready;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let snapshot;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/action`, { method: 'POST', headers, body: JSON.stringify({ type: 'snapshot' }) });
      snapshot = await response.json(); if (snapshot.telemetry?.ram_total) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(snapshot?.telemetry?.ram_total > 0);
  assert(snapshot.providers.length === 5);
  assert(snapshot.voice.available);
  const denied = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(denied.status, 401);
  console.log('Frozen Core OK: real telemetry, 5 providers, voice modules, authorization.');
} finally {
  child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
  const timeout = setTimeout(() => child.kill(), 5000);
  await new Promise(resolve => child.once('exit', resolve)); clearTimeout(timeout);
}
