import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const providers = new Set(['openai', 'gemini', 'claude', 'lmstudio', 'ollama']);
export class Vault {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private async encrypted(): Promise<Record<string, string>> {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, 'credentials.enc.json'), 'utf8')); }
    catch (e: any) { if (e.code === 'ENOENT') return {}; throw new Error('Cofre indisponível ou corrompido.'); }
  }
  async keys(): Promise<Record<string, string>> {
    const entries = await this.encrypted();
    const result: Record<string, string> = {};
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      if (Object.keys(entries).length) throw new Error('Criptografia do sistema indisponível.');
      return result;
    }
    for (const [provider, blob] of Object.entries(entries)) {
      if (providers.has(provider)) {
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(blob, 'base64'));
        result[provider] = decrypted.result;
        if (decrypted.shouldReEncrypt) await this.set(provider, decrypted.result);
      }
    }
    return result;
  }
  async set(provider: string, key: string) {
    if (!providers.has(provider) || key.length > 2048 || /[\r\n]/.test(key)) throw new Error('Credencial inválida.');
    const next = this.queue.then(async () => {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Criptografia do sistema indisponível.');
      const values = await this.encrypted();
      if (key) values[provider] = (await safeStorage.encryptStringAsync(key)).toString('base64');
      else delete values[provider];
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = path.join(this.directory, 'credentials.enc.tmp');
      await fs.writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
      await fs.rename(temporary, path.join(this.directory, 'credentials.enc.json'));
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
