"""A small allowlist, never a generic shell. Revalidate all paths at execution time."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timedelta, timezone
from uuid import uuid4

SPECS = [
    {'name': 'hardware', 'description': 'Consulta medições reais de CPU, RAM, GPU e disco.',
     'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
    {'name': 'read_file', 'description': 'Lê um arquivo de texto em uma pasta concedida pelo usuário.',
     'parameters': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path'], 'additionalProperties': False}},
    {'name': 'open_app', 'description': 'Abre um aplicativo pelo nome da lista permitida, após aprovação.',
     'parameters': {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name'], 'additionalProperties': False}},
    {'name': 'write_file', 'description': 'Cria um novo arquivo de texto, sem sobrescrever, após aprovação.',
     'parameters': {'type': 'object', 'properties': {'path': {'type': 'string'}, 'content': {'type': 'string'}}, 'required': ['path', 'content'], 'additionalProperties': False}},
    {'name': 'move_file', 'description': 'Move um arquivo dentro das pastas autorizadas, sem sobrescrever, após aprovação.',
     'parameters': {'type': 'object', 'properties': {'source': {'type': 'string'}, 'destination': {'type': 'string'}}, 'required': ['source', 'destination'], 'additionalProperties': False}},
]
REQUIRED = {s['name']: set(s['parameters'].get('required', [])) for s in SPECS}
FIELDS = {s['name']: set(s['parameters']['properties']) for s in SPECS}
SENSITIVE = {'.env', '.pem', '.key', '.pfx', '.p12', '.sqlite', '.sqlite3', '.db', 'credentials.json', 'id_rsa', 'id_ed25519'}


class Tools:
    def __init__(self, core):
        self.core = core
        self.pending = {}
        self.lock = asyncio.Lock()

    def path(self, text, *, existing=True):
        if not isinstance(text, str) or not text or ':' in text[2:]:
            raise ValueError('Caminho inválido.')
        if text.startswith(('\\\\', '//')):
            raise ValueError('Caminhos de rede e dispositivos não são permitidos.')
        original = Path(text)
        if not original.is_absolute():
            raise ValueError('Informe um caminho absoluto dentro de uma pasta autorizada.')
        resolved = original.resolve(strict=existing)
        if any(part.lower() in ('.git', '.ssh', '.aws', '.azure') for part in resolved.parts):
            raise ValueError('Pasta sensível bloqueada.')
        if resolved.name.lower() in SENSITIVE or resolved.suffix.lower() in SENSITIVE or resolved.name.startswith('.env'):
            raise ValueError('Arquivo de credenciais ou banco bloqueado.')
        roots = [Path(p).resolve(strict=True) for p in self.core.settings.allowed_roots]
        if not any(resolved.is_relative_to(root) and resolved != root for root in roots):
            raise ValueError('O arquivo está fora das pastas concedidas.')
        if resolved.is_relative_to(self.core.directory.resolve()):
            raise ValueError('Dados internos do JARVIS não podem ser acessados por ferramentas.')
        # Reject links/junctions throughout the path, including at execution time.
        for item in [original, *original.parents]:
            if item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
                raise ValueError('Links e junções não são permitidos em ferramentas de arquivo.')
        return resolved

    def validate(self, tool, args):
        if tool not in FIELDS or not isinstance(args, dict) or set(args) - FIELDS[tool] or REQUIRED[tool] - set(args):
            raise ValueError('Ferramenta ou parâmetros não permitidos.')
        if any(not isinstance(v, str) or len(v) > 100000 for v in args.values()):
            raise ValueError('Parâmetros inválidos ou grandes demais.')
        if any(self.core.redact(value) != value for value in args.values()):
            raise ValueError('Parâmetros contêm uma credencial conhecida; ação bloqueada.')
        if tool in ('read_file', 'write_file'):
            path = self.path(args['path'], existing=tool == 'read_file')
            if tool == 'write_file' and (path.exists() or not path.parent.is_dir()):
                raise ValueError('Criação exige uma pasta existente e um arquivo novo.')
            if tool == 'read_file' and (not path.is_file() or path.stat().st_size > 128000):
                raise ValueError('A leitura aceita apenas arquivos de texto de até 128 KB.')
        elif tool == 'move_file':
            source = self.path(args['source'])
            destination = self.path(args['destination'], existing=False)
            if not source.is_file() or destination.exists() or not destination.parent.is_dir():
                raise ValueError('A movimentação exige arquivo existente e destino novo.')
            if source.drive != destination.drive:
                raise ValueError('Movimentações entre volumes não são permitidas.')
        elif tool == 'open_app':
            path = Path(self.core.settings.apps.get(args['name'], ''))
            if not path.is_absolute() or not path.is_file() or path.suffix.lower() != '.exe':
                raise ValueError('Aplicativo não encontrado na lista permitida.')
        return args

    def fingerprint(self, tool, args):
        state = {'tool': tool, 'args': args, 'roots': self.core.settings.allowed_roots, 'apps': self.core.settings.apps}
        if tool == 'open_app':
            executable = Path(self.core.settings.apps.get(args.get('name', ''), ''))
            if executable.is_file():
                stat = executable.stat()
                state['executable_stat'] = [stat.st_size, stat.st_mtime_ns, stat.st_ino]
        # Bind reads/mutations to the state previewed by the user.
        for key in ('path', 'source', 'destination'):
            if key in args:
                p = Path(args[key])
                if p.exists():
                    stat = p.stat()
                    state[key + '_stat'] = [stat.st_size, stat.st_mtime_ns, stat.st_ino]
        return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()

    async def execute(self, tool, args, run_id=None):
        self.validate(tool, args)
        if tool == 'hardware':
            self.core.audit('tool.completed', {'tool': tool, 'source': 'system'})
            await self.core.bus.emit('tool.completed', {'tool': tool, 'result': 'Telemetria consultada no sistema operacional.'}, run_id)
            return self.core.telemetry
        # Reads also need confirmation: cloud prompts must not silently exfiltrate files.
        aid = str(uuid4())
        expiry = datetime.now(timezone.utc) + timedelta(minutes=5)
        future = asyncio.get_running_loop().create_future()
        summaries = {'read_file': 'Ler arquivo e disponibilizar seu conteúdo à IA desta execução.',
                     'write_file': 'Criar arquivo de texto sem sobrescrever.',
                     'move_file': 'Mover arquivo para o destino indicado.', 'open_app': 'Abrir aplicativo da lista permitida.'}
        approval = dict(id=aid, tool=tool, args=args.copy(), summary=summaries[tool],
                        expires_at=expiry.isoformat(), status='pending', run_id=run_id,
                        provider=self.core.runs.get(run_id, {}).get('provider', 'local'))
        self.pending[aid] = {'approval': approval, 'future': future, 'fingerprint': self.fingerprint(tool, args)}
        self.core.audit('tool.proposed', approval)
        await self.core.bus.emit('approval.required', approval, run_id)
        await self.core.stage(run_id, 'awaiting_approval')
        try:
            approved = await asyncio.wait_for(future, timeout=300)
            if not approved:
                raise ValueError('Ação negada pelo usuário.')
            async with self.lock:
                self.validate(tool, args)
                if self.fingerprint(tool, args) != self.pending[aid]['fingerprint']:
                    raise ValueError('Parâmetros, permissões ou arquivo mudaram. Solicite uma nova aprovação.')
                approval['status'] = 'executing'
                await self.core.stage(run_id, 'executing')
                await self.core.bus.emit('tool.started', approval, run_id)
                result = self.perform(tool, args)
                approval['status'] = 'completed'
                self.core.audit('tool.completed', {'id': aid, 'tool': tool, 'result': result if tool != 'read_file' else '[conteúdo omitido da auditoria]'})
                await self.core.bus.emit('tool.completed', {'id': aid, 'tool': tool, 'result': result}, run_id)
                return result
        except BaseException as exc:
            approval['status'] = 'cancelled' if isinstance(exc, asyncio.CancelledError) else 'failed'
            self.core.audit('tool.failed', {'id': aid, 'tool': tool, 'status': approval['status']})
            await self.core.bus.emit('tool.failed', {'id': aid, 'tool': tool, 'error': 'Cancelado' if isinstance(exc, asyncio.CancelledError) else self.core.redact(str(exc))}, run_id)
            raise
        finally:
            self.pending.pop(aid, None)
            await self.core.bus.emit('approval.resolved', {'id': aid, 'status': approval['status']}, run_id)

    def resolve(self, aid, approved):
        pending = self.pending.get(aid)
        if not pending or pending['future'].done():
            raise ValueError('Aprovação inexistente, expirada ou já utilizada.')
        pending['approval']['status'] = 'approved' if approved else 'denied'
        pending['future'].set_result(bool(approved))
        self.core.audit('approval.resolved', {'id': aid, 'approved': bool(approved)})

    def perform(self, tool, args):
        if tool == 'read_file':
            value = self.path(args['path']).read_text(encoding='utf-8')
            return {'path': args['path'], 'content': self.core.redact(value)}
        if tool == 'write_file':
            path = self.path(args['path'], existing=False)
            with path.open('x', encoding='utf-8') as stream:
                stream.write(args['content'])
            return {'created': str(path), 'bytes': path.stat().st_size}
        if tool == 'move_file':
            source, destination = self.path(args['source']), self.path(args['destination'], existing=False)
            # Windows rename fails if a destination appears concurrently; no overwrite.
            if os.name != 'nt':
                os.link(source, destination)
                source.unlink()
            else:
                source.rename(destination)
            return {'moved': str(source), 'destination': str(destination)}
        if tool == 'open_app':
            executable = self.core.settings.apps[args['name']]
            process = subprocess.Popen([executable], shell=False, close_fds=True)
            return {'launched': args['name'], 'pid': process.pid, 'verified': 'process_created'}
        raise ValueError('Ferramenta não permitida.')
