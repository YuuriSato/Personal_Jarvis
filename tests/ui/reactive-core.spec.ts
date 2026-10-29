import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('Núcleo acelera apenas durante pedido ativo e respeita movimento reduzido', async () => {
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain request */ }
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ models: [{ key: 'visual-test', type: 'llm', loaded_instances: [{ id: 'visual-test' }], capabilities: { trained_for_tool_use: false } }] }));
    } else {
      res.setHeader('Content-Type', 'text/event-stream');
      setTimeout(() => res.end('data: {"choices":[{"delta":{"content":"Solicitação de teste concluída."}}]}\n\ndata: [DONE]\n\n'), 4000);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-visual-e2e-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, JARVIS_TEST_MODE: '1', JARVIS_TEST_DATA: directory } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('CORE_ONLINE', { exact: false })).toBeVisible({ timeout: 45000 });
    await page.evaluate(async url => window.jarvis!.action({ type: 'provider', provider: 'lmstudio', config: { base_url: url, model: 'visual-test' } }), `http://127.0.0.1:${port}/v1`);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole('textbox', { name: 'Comando', exact: true }).fill('Teste de processamento visual.');
    await page.getByRole('button', { name: 'EXECUTE' }).click();
    await expect(page.locator('.core-thinking-tag')).toHaveText('ANALISANDO');
    await expect(page.locator('.core-processing .ring-a')).toHaveCSS('animation-duration', '3.8s');
    await page.screenshot({ path: 'work/core-thinking.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.visual-core')).toHaveClass(/reduced/);
    await expect(page.locator('.ring-a')).toHaveCSS('animation-duration', '0s');
    await expect(page.locator('.log-assistant').last()).toContainText('Solicitação de teste concluída.');
    await expect(page.locator('.core-thinking-tag')).toHaveCount(0);
  } finally { await app.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Ausência de microfone é informada sem fingir captura', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-mic-e2e-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, JARVIS_TEST_MODE: '1', JARVIS_TEST_DATA: directory } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('CORE_ONLINE', { exact: false })).toBeVisible({ timeout: 45000 });
    await page.evaluate(async () => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('No microphone', 'NotFoundError'); };
      await window.jarvis!.action({ type: 'settings', settings: { voice_enabled: true } });
    });
    await page.getByRole('button', { name: 'Iniciar comando de voz' }).click();
    await expect(page.getByRole('status')).toContainText('Nenhum microfone está disponível');
    await expect(page.getByRole('button', { name: 'Encerrar gravação e enviar' })).toHaveCount(0);
  } finally { await app.close(); }
});
