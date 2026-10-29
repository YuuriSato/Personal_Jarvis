import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import WebSocket from 'ws';
import { app } from 'electron';

export class Backend extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private socket?: WebSocket;
  private port = 0;
  private token = randomBytes(32).toString('hex');
  private stopping = false;
  private sequence = 0;
  private lastSequence = -1;
  private sessionId = '';
  private reconnect?: ReturnType<typeof setTimeout>;
  private keyAcks = new Map<string, () => void>();
  async start(directory: string, keys: Record<string, string>) {
    const root = app.getAppPath();
    const executable = app.isPackaged ? path.join(process.resourcesPath, 'core', 'jarvis-core.exe') : path.join(root, '.venv', 'Scripts', 'python.exe');
    const args = app.isPackaged ? [] : ['-m', 'services.core.launcher'];
    const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', DO_NOT_TRACK: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PROGRAMDATA', 'PROGRAMFILES']) {
      const actual = Object.keys(process.env).find(key => key.toLowerCase() === name.toLowerCase());
      if (actual) environment[actual] = process.env[actual];
    }
    this.child = spawn(executable, args, { cwd: app.isPackaged ? process.resourcesPath : root, windowsHide: true, stdio: 'pipe', env: environment });
    this.child.stderr.on('data', () => {}); // Never forward arbitrary exception bodies to renderer/logs.
    this.child.once('exit', () => {
      this.socket?.close();
      if (!this.stopping) this.emitDisconnected('O serviço local foi encerrado. Reinicie o aplicativo.');
    });
    this.child.stdin.write(JSON.stringify({ token: this.token, directory, keys }) + '\n');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('O Core não iniciou no tempo esperado.')), 45000);
      const lines = createInterface({ input: this.child!.stdout });
      this.child!.once('error', () => { clearTimeout(timer); reject(new Error('Não foi possível iniciar o Core Python. Execute a configuração do projeto.')); });
      this.child!.once('exit', () => { clearTimeout(timer); reject(new Error('O Core foi encerrado durante a inicialização.')); });
      lines.on('line', (line) => {
        try {
          const result = JSON.parse(line);
          if (result.key_ack) { this.keyAcks.get(result.key_ack)?.(); this.keyAcks.delete(result.key_ack); }
          if (result.ready && Number.isInteger(result.port)) { this.port = result.port; clearTimeout(timer); resolve(); }
        } catch { /* Ignore non-protocol stdout. */ }
      });
    });
    for (let n = 0; n < 100; n++) {
      try { await this.request('/health', undefined, 1500); this.connect(); return; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    throw new Error('O Core não ficou disponível.');
  }
  private emitDisconnected(message: string) {
    this.emit('event', { version: 1, event_id: `desktop-${++this.sequence}`, sequence: this.sequence,
      timestamp: new Date().toISOString(), session_id: 'desktop', run_id: null,
      type: 'core.disconnected', source: 'desktop', payload: { message } });
  }
  private connect() {
    if (this.stopping) return;
    this.socket = new WebSocket(`ws://127.0.0.1:${this.port}/events`, { headers: { Authorization: `Bearer ${this.token}` } });
    this.socket.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'heartbeat') return;
        if (event.session_id !== this.sessionId) { this.lastSequence = -1; this.sessionId = event.session_id; }
        if (event.sequence <= this.lastSequence) return;
        this.lastSequence = event.sequence;
        this.emit('event', event);
      } catch { /* Untrusted/invalid event. */ }
    });
    this.socket.on('error', () => {});
    this.socket.on('close', () => {
      if (!this.stopping) {
        this.emitDisconnected('Reconectando ao serviço local…');
        this.reconnect = setTimeout(() => this.connect(), 1500);
      }
    });
  }
  async request(route: string, data?: unknown, timeout = 120000): Promise<any> {
    if (!this.port) throw new Error('Core indisponível.');
    const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
      method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(timeout),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Solicitação inválida.');
    return body;
  }
  async key(provider: string, key: string) {
    const id = randomBytes(16).toString('hex');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.keyAcks.delete(id); reject(new Error('O Core não confirmou a atualização do cofre.')); }, 5000);
      this.keyAcks.set(id, () => { clearTimeout(timer); resolve(); });
      this.child?.stdin.write(JSON.stringify({ type: 'key', id, provider, key }) + '\n');
    });
  }
  async stop() {
    this.stopping = true;
    clearTimeout(this.reconnect);
    this.socket?.close();
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise<void>(resolve => setTimeout(resolve, 4000))]);
    if (child.exitCode === null) child.kill();
  }
}
