// Explicit local-model test: no downloads, microphone recording or paid APIs.
// Usage: node scripts/smoke-voice.mjs prepared-profile pt-fixture.wav wake-fixture.wav
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const [profile, speechFile, wakeFile] = process.argv.slice(2);
assert(profile && speechFile && wakeFile, 'Provide prepared model directory and two synthetic PCM16 WAV fixtures.');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-frozen-voice-'));
for (const folder of ['voice-model', 'wake-models', 'tts-pt-BR']) {
  const destination = path.join(directory, folder);
  await fs.mkdir(destination);
  for (const file of await fs.readdir(path.join(profile, folder), { withFileTypes: true })) {
    if (file.isFile() && !file.name.startsWith('.')) {
      const source = path.join(profile, folder, file.name), target = path.join(destination, file.name);
      await fs.link(source, target).catch(() => fs.copyFile(source, target));
    }
  }
}
async function pcm(file) {
  const wav = await fs.readFile(file);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  let rate, channels, audio;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const kind = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (kind === 'fmt ') {
      assert.equal(wav.readUInt16LE(start), 1, 'Fixture must be PCM');
      channels = wav.readUInt16LE(start + 2); rate = wav.readUInt32LE(start + 4);
      assert.equal(wav.readUInt16LE(start + 14), 16);
    }
    if (kind === 'data') audio = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  assert(audio && rate && channels);
  return Array.from({ length: Math.floor(audio.length / (2 * channels) * 16000 / rate) }, (_, i) => {
    const index = Math.min(Math.floor(i * rate / 16000), audio.length / (2 * channels) - 1);
    return audio.readInt16LE(index * channels * 2);
  });
}
const child = spawn(path.resolve('dist/jarvis-core/jarvis-core.exe'), [], {
  stdio: 'pipe', windowsHide: true,
  env: { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') },
});
let errors = '';
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
child.stdin.on('error', () => {}); // Preserve the original failure when a worker has exited.
const token = randomBytes(32).toString('hex');
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Core startup timeout: ' + errors)), 60000);
  createInterface({ input: child.stdout }).on('line', line => {
    try { const value = JSON.parse(line); if (value.ready) { clearTimeout(timer); resolve(value.port); } } catch {}
  });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Core exited ${code}: ${errors}`)); });
});
child.stdin.write(JSON.stringify({ token, directory, keys: {} }) + '\n');
let socket;
try {
  const port = await ready, headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const startupDeadline = Date.now() + 45000;
  while (true) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`, { headers, signal: AbortSignal.timeout(1000) })).ok) break;
    } catch { /* bootstrap announces its port before the HTTP listener is ready */ }
    assert(Date.now() < startupDeadline, 'HTTP startup timeout: ' + errors);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const action = async value => {
    const response = await fetch(`http://127.0.0.1:${port}/action`, { method: 'POST', headers, body: JSON.stringify(value), signal: AbortSignal.timeout(120000) });
    const result = await response.json();
    assert(response.ok, JSON.stringify(result) + '\n' + errors);
    return result;
  };
  await action({ type: 'settings', settings: { voice_enabled: true, local_only: true } });
  assert((await action({ type: 'snapshot' })).voice.piper_ready);
  console.log('Frozen voice: checking actual Portuguese playback…');
  socket = new WebSocket(`ws://127.0.0.1:${port}/events`, { headers: { Authorization: headers.Authorization } });
  const events = [];
  socket.on('message', value => events.push(JSON.parse(value.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await action({ type: 'voice_speak', text: 'Olá! O Jarvis está pronto para ajudar.' });
  const deadline = Date.now() + 60000;
  while (!events.some(e => e.type === 'voice.state_changed' && e.payload.state === 'idle')) {
    assert(Date.now() < deadline, 'Speech timeout: ' + errors);
    assert(!events.some(e => e.type === 'voice.failed'), JSON.stringify(events));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(events.some(e => e.type === 'voice.amplitude' && e.payload.value > .01), 'Missing real playback amplitude: ' + errors);
  const startAt = events.length;
  await action({ type: 'voice_speak', text: 'Esta é uma resposta longa para verificar a interrupção da voz local. '.repeat(8) });
  const speakingDeadline = Date.now() + 60000;
  while (!events.slice(startAt).some(e => e.type === 'voice.amplitude' && e.payload.value > .01)) {
    assert(Date.now() < speakingDeadline, 'Playback did not start for cancellation test');
    assert(!events.slice(startAt).some(e => e.type === 'voice.failed'), JSON.stringify(events.slice(startAt)));
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const stoppedAt = events.length, stopStarted = Date.now();
  await action({ type: 'voice_stop' });
  while (!events.slice(stoppedAt).some(e => e.type === 'voice.state_changed' && e.payload.state === 'idle')) {
    assert(Date.now() - stopStarted < 5000, 'Packaged speech failed to stop');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  console.log(`Frozen voice: interruption passed in ${Date.now() - stopStarted} ms.`);
  console.log('Frozen voice: playback passed; transcribing synthetic Portuguese fixture…');
  const transcript = await action({ type: 'voice_transcribe', audio: await pcm(speechFile), sample_rate: 16000 });
  assert(/computador|memória/i.test(transcript.text), transcript.text);
  console.log('Frozen voice: transcription passed; checking synthetic wake fixture…');
  await action({ type: 'settings', settings: { wake_word: true } });
  const wake = [...Array(16000).fill(0), ...await pcm(wakeFile), ...Array(16000).fill(0)];
  let detections = 0;
  for (let i = 0; i + 1280 <= wake.length; i += 1280) {
    detections += Number((await action({ type: 'wake_audio', audio: wake.slice(i, i + 1280) })).detected);
  }
  assert(detections > 0, 'No wake detection for synthetic fixture');
  console.log(JSON.stringify({ frozen_voice: 'passed', transcript: transcript.text, tts: 'Piper pt_BR actual playback', synthetic_wake_detections: detections, microphone_recorded: false }));
} finally {
  socket?.close();
  const exited = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
  if (child.exitCode === null) child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
  const timer = setTimeout(() => child.kill(), 5000);
  await exited; clearTimeout(timer);
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert(path.basename(directory).startsWith('jarvis-frozen-voice-'));
  await fs.rm(directory, { recursive: true, force: true });
}
