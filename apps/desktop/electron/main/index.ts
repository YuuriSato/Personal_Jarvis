import { app, BrowserWindow, dialog, ipcMain, session, protocol, net } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import { Backend } from '../backend-supervisor/index.js';
import { Vault } from '../credentials/vault.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const directory = path.dirname(fileURLToPath(import.meta.url));
const backend = new Backend();
let window: BrowserWindow | null = null;
let quitting = false;
const chosenFolders = new Set<string>();
const chosenApps = new Set<string>();
const providerSchema = z.enum(['openai', 'gemini', 'claude', 'lmstudio', 'ollama']);
const permittedActions = new Set(['snapshot', 'message', 'cancel', 'settings', 'provider', 'models', 'lmstudio_load', 'approve', 'tool', 'memory', 'memory_delete', 'memory_index', 'memory_search', 'history_clear', 'voice_prepare', 'voice_transcribe', 'voice_speak', 'voice_stop', 'wake_audio']);

function checkSender(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Remetente não autorizado.');
  const url = event.senderFrame.url;
  if (!(app.isPackaged ? url.startsWith('jarvis://app/') : url.startsWith('http://127.0.0.1:5187/'))) throw new Error('Origem não autorizada.');
}

app.whenReady().then(async () => {
  const dataDirectory = process.env.JARVIS_TEST_DATA || path.join(app.getPath('userData'), 'data');
  const vault = new Vault(dataDirectory);
  if (app.isPackaged) protocol.handle('jarvis', request => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const target = path.resolve(directory, '../../renderer', '.' + pathname);
    const root = path.resolve(directory, '../../renderer');
    if (target !== root && !target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target === root ? path.join(root, 'index.html') : target).href);
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = contents.getURL();
    const allowedOrigin = app.isPackaged ? url.startsWith('jarvis://app/') : url.startsWith('http://127.0.0.1:5187/');
    callback(permission === 'media' && allowedOrigin && !(details as any).mediaTypes?.includes('video'));
  });
  window = new BrowserWindow({ width: 1600, height: 940, minWidth: 900, minHeight: 650, backgroundColor: '#030810',
    title: 'JARVIS', show: process.env.JARVIS_TEST_MODE !== '1', autoHideMenuBar: true,
    webPreferences: { preload: path.join(directory, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  backend.on('event', event => { if (window && !window.isDestroyed()) window.webContents.send('jarvis:event', event); });
  ipcMain.handle('jarvis:action', async (event, raw) => {
    checkSender(event);
    if (!raw || !permittedActions.has(raw.type) || JSON.stringify(raw).length > 8_000_000) throw new Error('Ação inválida.');
    if (raw.type === 'settings') {
      const snapshot = await backend.request('/action', { type: 'snapshot' });
      const roots = raw.settings?.allowed_roots as unknown;
      if (roots !== undefined && (!Array.isArray(roots) || roots.some((p: string) => typeof p !== 'string' || (!chosenFolders.has(p) && !snapshot.settings.allowed_roots.includes(p))))) throw new Error('Conceda pastas usando o seletor do sistema.');
      const apps = raw.settings?.apps;
      if (apps !== undefined && (typeof apps !== 'object' || Object.values(apps).some(p => typeof p !== 'string' || (!chosenApps.has(p) && !Object.values(snapshot.settings.apps).includes(p))))) throw new Error('Conceda aplicativos usando o seletor do sistema.');
    }
    return backend.request('/action', raw, raw.type === 'voice_prepare' ? 600000 : 180000);
  });
  ipcMain.handle('jarvis:key', async (event, raw) => {
    checkSender(event);
    const { provider, key } = z.object({ provider: providerSchema, key: z.string().max(2048) }).parse(raw);
    await backend.request('/action', { type: 'cancel' });
    await vault.set(provider, key.trim());
    await backend.key(provider, key.trim());
    return { ok: true };
  });
  ipcMain.handle('jarvis:folder', async event => {
    checkSender(event);
    const result = await dialog.showOpenDialog(window!, { title: 'Conceder acesso de ferramentas a uma pasta', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const folder = await fs.realpath(result.filePaths[0]); chosenFolders.add(folder); return folder;
  });
  ipcMain.handle('jarvis:app', async event => {
    checkSender(event);
    const result = await dialog.showOpenDialog(window!, { title: 'Permitir abertura de aplicativo', filters: [{ name: 'Aplicativo Windows', extensions: ['exe'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const executable = await fs.realpath(result.filePaths[0]); chosenApps.add(executable); return executable;
  });
  ipcMain.handle('jarvis:export', async event => {
    checkSender(event);
    const result = await dialog.showSaveDialog(window!, { title: 'Exportar histórico e memórias', defaultPath: 'jarvis-export.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    const data = await backend.request('/action', { type: 'export' });
    await fs.writeFile(result.filePath, JSON.stringify(data, null, 2));
    return true;
  });
  await window.loadURL(app.isPackaged ? 'jarvis://app/index.html' : 'http://127.0.0.1:5187/');
  try { await backend.start(dataDirectory, await vault.keys()); }
  catch (error) {
    window.webContents.send('jarvis:event', { version: 1, event_id: 'startup-error', sequence: 0, timestamp: new Date().toISOString(), session_id: 'desktop', run_id: null, type: 'core.disconnected', source: 'desktop', payload: { message: (error as Error).message } });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  backend.stop().finally(() => app.quit());
});
