import { _electron } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-packaged-'));
const data = path.join(temporary, 'data'), files = path.join(temporary, 'files');
await fs.mkdir(files);
const app = await _electron.launch({ executablePath: path.resolve('release/win-unpacked/JARVIS.exe'),
  env: { ...process.env, PATH: path.join(process.env.SystemRoot || 'C:/Windows', 'System32'), JARVIS_TEST_MODE: '1', JARVIS_TEST_DATA: data },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.body.textContent?.includes('CORE_ONLINE'), null, { timeout: 45000 });
  assert(page.url().startsWith('jarvis://app/'));
  const snapshot = await page.evaluate(async () => window.jarvis.action({ type: 'snapshot' }));
  assert.equal(snapshot.providers.length, 5);
  assert(snapshot.telemetry.ram_total > 0);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await assert.rejects(page.evaluate(async () => window.jarvis.action({ type: 'settings', settings: { allowed_roots: ['C:/Windows'] } })), /seletor/);
  const fake = 'packaged-e2e-fake-credential';
  await page.evaluate(async key => window.jarvis.saveKey('openai', key), fake);
  assert(!(await fs.readFile(path.join(data, 'credentials.enc.json'), 'utf8')).includes(fake));
  await page.evaluate(async () => window.jarvis.removeKey('openai'));
  await app.evaluate(({ dialog }, allowed) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [allowed] }); }, files);
  const folder = await page.evaluate(async () => window.jarvis.chooseFolder());
  await page.evaluate(async allowed => window.jarvis.action({ type: 'settings', settings: { local_only: true, allowed_roots: [allowed] } }), folder);
  const destination = path.join(files, 'approved.txt');
  await page.evaluate(async file => window.jarvis.action({ type: 'tool', tool: 'write_file', args: { path: file, content: 'approved fixture' } }), destination);
  await page.getByRole('alertdialog').waitFor();
  assert(!(await fs.stat(destination).catch(() => null)));
  const approval = await page.evaluate(async () => (await window.jarvis.action({ type: 'snapshot' })).approvals[0].id);
  await page.getByRole('button', { name: 'Aprovar esta ação' }).click();
  for (let i = 0; i < 50; i++) { if (await fs.stat(destination).catch(() => null)) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(await fs.readFile(destination, 'utf8'), 'approved fixture');
  await assert.rejects(page.evaluate(async id => window.jarvis.action({ type: 'approve', id, approved: true }), approval), /utilizada|inexistente/);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'work/desktop-packaged.png' });
  console.log('Packaged desktop OK: custom protocol, bundled Python, real telemetry, encrypted vault, native folder grant, exact one-use approval.');
} finally { await app.close(); }
