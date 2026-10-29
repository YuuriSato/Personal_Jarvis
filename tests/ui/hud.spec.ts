import { expect, test, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';

for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1536, height: 864 }]) {
  test(`HUD sem dados inventados e sem cortes ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByText('CORE_OFFLINE', { exact: false })).toBeVisible();
    await expect(page.getByText('PRÉVIA DA INTERFACE · CORE DESCONECTADO')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Comando', exact: true })).toBeDisabled();
    await expect(page.getByText('INDISPONÍVEL', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const bar = await page.locator('.command-bar').boundingBox();
    expect(bar!.y + bar!.height).toBeLessThan(size.height);
    await page.screenshot({ path: `work/hud-${size.width}.png` });
    expect(errors).toEqual([]);
  });
}

test('Configuração e logs são controláveis na prévia', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await expect(page.getByRole('dialog', { name: 'Configurações do JARVIS' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Core desconectado' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await page.getByRole('button', { name: 'HIDE LOGS' }).click();
  await expect(page.getByRole('complementary', { name: 'Terminal de conversas' })).not.toBeVisible();
  await page.getByRole('button', { name: 'SHOW LOGS' }).click();
  await expect(page.getByRole('complementary', { name: 'Terminal de conversas' })).toBeVisible();
});

test('Electron conecta Core real, protege credenciais e executa diagnóstico', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-e2e-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, JARVIS_TEST_MODE: '1', JARVIS_TEST_DATA: directory } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('CORE_ONLINE', { exact: false })).toBeVisible({ timeout: 45000 });
    const settings = await page.evaluate(async () => window.jarvis!.action({ type: 'snapshot' }));
    expect(settings.providers.filter((p: any) => !p.local).every((p: any) => !p.enabled)).toBeTruthy();
    await page.waitForFunction(async () => (await window.jarvis!.action({ type: 'snapshot' })).telemetry?.ram_total > 0);
    const secret = 'jarvis-e2e-only-fake-credential';
    await page.evaluate(async value => window.jarvis!.saveKey('openai', value), secret);
    await expect.poll(async () => page.evaluate(async () => (await window.jarvis!.action({ type: 'snapshot' })).providers.find((p: any) => p.id === 'openai').has_key)).toBe(true);
    const encrypted = await fs.readFile(path.join(directory, 'credentials.enc.json'), 'utf8');
    expect(encrypted).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(async () => window.jarvis!.action({ type: 'snapshot' })))).not.toContain(secret);
    await page.evaluate(async () => window.jarvis!.removeKey('openai'));
    await page.getByRole('textbox', { name: 'Comando', exact: true }).fill('/hardware');
    await page.getByRole('button', { name: 'EXECUTE' }).click();
    await expect(page.locator('.log-assistant').last()).toContainText('ram_total');
    await page.getByRole('button', { name: 'Abrir configurações' }).click();
    await page.getByRole('button', { name: 'Privacidade' }).click();
    await page.getByLabel('Somente local', { exact: false }).click();
    await expect(page.getByLabel('Somente local', { exact: false })).toBeChecked();
    await expect.poll(async () => page.evaluate(async () => (await window.jarvis!.action({ type: 'snapshot' })).settings.local_only)).toBe(true);
    await page.getByRole('button', { name: 'Memória', exact: true }).click();
    await page.getByLabel('Preferência ou fato consentido').fill('Prefiro respostas em português.');
    await page.getByRole('button', { name: 'Memorizar com meu consentimento' }).click();
    await expect(page.locator('.memory-list')).toContainText('Prefiro respostas em português.');
    await page.getByLabel('Preferência ou fato consentido').fill('Teste de expiração no fuso local.');
    await page.getByLabel('Expiração opcional').fill('2027-01-01T10:00');
    await page.getByRole('button', { name: 'Memorizar com meu consentimento' }).click();
    const expiryMemory = page.locator('.memory-list article').filter({ hasText: 'Teste de expiração no fuso local.' });
    await expiryMemory.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(page.getByLabel('Expiração opcional')).toHaveValue('2027-01-01T10:00');
    await page.getByRole('button', { name: 'Fechar configurações' }).click();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ path: 'work/desktop-live.png' });
    await expect(page.evaluate(() => typeof (window as any).require)).resolves.toBe('undefined');
  } finally { await app.close(); }
});

test('LM Studio: catálogo nativo, carregamento explícito e conversa em streaming', async () => {
  let loaded = false;
  let loads = 0;
  let chats = 0;
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    const body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {};
    if (request.url === '/api/v1/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ models: [
        { type: 'llm', key: 'test-assistant', display_name: 'Test Assistant', loaded_instances: loaded ? [{ id: 'test-assistant-instance' }] : [], capabilities: { trained_for_tool_use: true } },
        { type: 'embedding', key: 'test-embedding', loaded_instances: [] },
      ] }));
    } else if (request.url === '/api/v1/models/load') {
      expect(body.model).toBe('test-assistant'); loads++; loaded = true;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'loaded', instance_id: 'test-assistant-instance' }));
    } else if (request.url === '/v1/chat/completions') {
      expect(body.model).toBe('test-assistant-instance'); chats++;
      response.setHeader('Content-Type', 'text/event-stream');
      response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Olá do servidor de teste local.' } }] }) + '\n\ndata: [DONE]\n\n');
    } else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-lmstudio-e2e-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, JARVIS_TEST_MODE: '1', JARVIS_TEST_DATA: directory } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('CORE_ONLINE', { exact: false })).toBeVisible({ timeout: 45000 });
    await page.evaluate(async url => window.jarvis!.action({ type: 'provider', provider: 'lmstudio', config: { base_url: url } }), `http://127.0.0.1:${port}/v1`);
    await page.getByRole('button', { name: 'Abrir configurações' }).click();
    await page.getByRole('button', { name: 'Consultar modelos' }).click();
    await page.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('test-assistant');
    await expect(page.getByText('BAIXADO / NÃO CARREGADO')).toBeVisible();
    expect(loads).toBe(0);
    await expect(page.getByRole('combobox', { name: 'Modelo', exact: true }).locator('option')).toHaveCount(2);
    await page.getByRole('button', { name: 'Carregar modelo selecionado' }).click();
    await expect(page.getByText('Pronto para conversar pelo servidor local.')).toBeVisible();
    expect(loads).toBe(1);
    await page.getByRole('button', { name: 'Usar LM Studio' }).click();
    await page.getByRole('button', { name: 'Fechar configurações' }).click();
    await page.getByRole('textbox', { name: 'Comando', exact: true }).fill('Diga olá.');
    await page.getByRole('button', { name: 'EXECUTE' }).click();
    await expect(page.locator('.log-assistant').last()).toContainText('Olá do servidor de teste local.');
    expect(chats).toBe(1);
  } finally { await app.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
