import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const directory = path.join(root, 'release', `JARVIS-v${version}`);
const installer = `JARVIS Setup ${version}.exe`;
await fs.access(path.join(directory, installer));
for (const [source, destination] of [
  ['assets/icon.png', 'logo.png'], ['assets/icon.ico', 'logo.ico'],
  ['README.md', 'LEIA-ME.md'], ['docs/VALIDATION.md', 'VALIDACAO.md'],
  ['docs/THIRD_PARTY_VOICE.md', 'LICENCAS-VOZ.md'],
]) await fs.copyFile(path.join(root, source), path.join(directory, destination));
const hash = createHash('sha256');
for await (const chunk of createReadStream(path.join(directory, installer))) hash.update(chunk);
await fs.writeFile(path.join(directory, `${installer}.sha256`), `${hash.digest('hex')}  ${installer}\n`);
console.log(`Versão organizada em release/JARVIS-v${version}/`);
