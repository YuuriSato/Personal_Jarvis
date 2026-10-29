import path from 'node:path';
import { spawn } from 'node:child_process';
const executable = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });
child.once('error', () => { console.error('Python local indisponível. Crie .venv antes de continuar.'); process.exit(1); });
child.once('exit', code => process.exit(code ?? 1));
