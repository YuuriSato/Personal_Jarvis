import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient
from services.core.api import create_app
from services.core.contracts import Action, Settings, local_url
from services.core.orchestration import Core
from services.core.persistence import Store
from services.core.providers import Providers, ProviderError


@pytest.fixture
def core(tmp_path):
    value = Core(tmp_path / 'data')
    yield value
    value.collector.close()
    value.store.close()


async def pending(core):
    for _ in range(100):
        if core.tools.pending:
            return next(iter(core.tools.pending))
        await asyncio.sleep(.001)
    raise AssertionError('Approval not received')


def test_schema_rejects_unknown_and_unsafe_values():
    with pytest.raises(ValueError):
        Settings(shell_enabled=True)
    with pytest.raises(ValueError):
        Action(type='voice_transcribe', audio=[99999])
    for url in ['http://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'http://192.168.1.1', 'file:///etc/passwd']:
        with pytest.raises(ValueError):
            local_url(url)
    assert local_url('http://127.0.0.1:1234/v1')


def test_database_persists_and_migrations_are_idempotent(tmp_path):
    store = Store(tmp_path)
    store.put('settings', {'local_only': True})
    store.message('session', 'user', 'Olá')
    memory_id = store.remember('Prefiro português')
    store.audit('test', {'ok': True})
    store.close()
    reopened = Store(tmp_path)
    assert reopened.get('settings')['local_only'] is True
    assert reopened.messages()[0]['content'] == 'Olá'
    assert reopened.memories('português')[0]['id'] == memory_id
    assert len(reopened.export()['audit']) == 1
    assert reopened.db.execute('SELECT count(*) FROM migrations').fetchone()[0] == 1
    reopened.forget(memory_id)
    reopened.clear_history()
    assert not reopened.memories() and not reopened.messages()
    reopened.close()


def test_expired_memory_not_retrieved(core):
    with pytest.raises(ValueError):
        core.store.remember('old', expires_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    core.store.db.execute('INSERT INTO memories VALUES(?,?,?,?,?)', ('old', 'expired', 'user', '2000-01-01', '2001-01-01T00:00:00+00:00'))
    assert not core.store.memories()


def test_real_telemetry_has_units_and_unavailable_is_null(core):
    first = core.collector.sample()
    assert first['cpu_percent'] is None
    assert first['ram_total'] > 0 and first['cpu_threads'] > 0
    assert 'timestamp' in first and 'source' in first
    assert core.collector.sample()['cpu_percent'] is not None


def test_secrets_redacted_from_snapshots_audit_and_export(core):
    secret = 'test-credential-this-must-never-leak'
    core.providers.secrets['openai'] = secret
    core.audit('test', {'content': f'key={secret}', 'authorization': secret})
    core.store.remember(core.providers.redact(f'hello {secret}'))
    assert secret not in json.dumps(core.snapshot())
    assert secret not in json.dumps(core.store.export())
    assert core.providers.public()[0]['has_key'] is True


def test_path_restrictions(core, tmp_path):
    allowed = tmp_path / 'allowed'
    allowed.mkdir()
    core.settings.allowed_roots = [str(allowed)]
    for name in ['.env', 'private.key', 'id_rsa', 'secrets.sqlite3']:
        file = allowed / name
        file.write_text('sensitive')
        with pytest.raises(ValueError):
            core.tools.path(str(file))
    outside = tmp_path / 'outside.txt'
    outside.write_text('private')
    with pytest.raises(ValueError):
        core.tools.path(str(outside))
    with pytest.raises(ValueError):
        core.tools.path(str(allowed / '..' / 'outside.txt'))
    with pytest.raises(ValueError):
        core.tools.path(r'\\example.test\share\secret.txt')
    with pytest.raises(ValueError):
        core.tools.validate('shell', {'command': 'anything'})


async def test_write_requires_single_use_approval(core, tmp_path):
    core.settings.allowed_roots = [str(tmp_path)]
    target = tmp_path / 'new.txt'
    task = asyncio.create_task(core.tools.execute('write_file', {'path': str(target), 'content': 'hello'}))
    aid = await pending(core)
    assert not target.exists()
    core.tools.resolve(aid, True)
    result = await task
    assert target.read_text() == 'hello' and result['bytes'] == 5
    with pytest.raises(ValueError):
        core.tools.resolve(aid, True)
    with pytest.raises(ValueError):
        await core.tools.execute('write_file', {'path': str(target), 'content': 'overwrite'})


async def test_denied_action_does_not_mutate(core, tmp_path):
    core.settings.allowed_roots = [str(tmp_path)]
    target = tmp_path / 'denied.txt'
    task = asyncio.create_task(core.tools.execute('write_file', {'path': str(target), 'content': 'hello'}))
    core.tools.resolve(await pending(core), False)
    with pytest.raises(ValueError, match='negada'):
        await task
    assert not target.exists()


async def test_changed_permissions_invalidate_approval(core, tmp_path):
    core.settings.allowed_roots = [str(tmp_path)]
    target = tmp_path / 'file.txt'
    task = asyncio.create_task(core.tools.execute('write_file', {'path': str(target), 'content': 'hello'}))
    aid = await pending(core)
    core.settings.allowed_roots = []
    core.tools.resolve(aid, True)
    with pytest.raises(ValueError):
        await task
    assert not target.exists()


async def test_changed_file_invalidates_read_approval(core, tmp_path):
    core.settings.allowed_roots = [str(tmp_path)]
    target = tmp_path / 'file.txt'
    target.write_text('before')
    task = asyncio.create_task(core.tools.execute('read_file', {'path': str(target)}))
    aid = await pending(core)
    target.write_text('after with changed length')
    core.tools.resolve(aid, True)
    with pytest.raises(ValueError, match='mudaram'):
        await task


async def test_cancel_pending_approval_does_not_create_file(core, tmp_path):
    core.settings.allowed_roots = [str(tmp_path)]
    target = tmp_path / 'cancelled.txt'
    task = asyncio.create_task(core.tools.execute('write_file', {'path': str(target), 'content': 'hello'}))
    await pending(core)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not target.exists() and not core.tools.pending


async def test_move_never_overwrites(core, tmp_path):
    core.settings.allowed_roots = [str(tmp_path)]
    source, destination = tmp_path / 'a.txt', tmp_path / 'b.txt'
    source.write_text('source'); destination.write_text('destination')
    with pytest.raises(ValueError):
        await core.tools.execute('move_file', {'source': str(source), 'destination': str(destination)})
    assert source.read_text() == 'source' and destination.read_text() == 'destination'


async def test_local_only_blocks_all_remote_models_and_weather_without_requests(tmp_path):
    requests = []
    transport = httpx.MockTransport(lambda request: requests.append(request) or httpx.Response(200, json={}))
    core = Core(tmp_path, transport)
    core.settings.local_only = True
    core.settings.weather_enabled = True
    core.settings.latitude = -23.5; core.settings.longitude = -46.6
    for key in ['openai', 'gemini', 'claude']:
        core.providers.configs[key].enabled = True
        core.providers.secrets[key] = 'test'
        with pytest.raises(ProviderError, match='bloqueado'):
            await core.providers.discover(key, True)
    await core.update_weather()
    assert not requests and core.weather['status'] == 'blocked_local'
    await core.stop()


async def test_ollama_cloud_behind_loopback_is_blocked():
    requests = []
    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(200, json={'remote_host': 'https://ollama.com'})
    providers = Providers(transport=httpx.MockTransport(respond))
    with pytest.raises(ProviderError):
        async for _ in providers.stream('ollama', 'remote', [], [], 128, True):
            pass
    assert len(requests) == 1 and requests[0].endswith('/show')


def test_manual_never_falls_back(core):
    core.settings.provider = 'openai'
    assert core.choose() == ['openai']
    core.settings.local_only = True
    assert core.choose() == ['openai']  # The provider gate rejects it; no silent replacement.


def test_automatic_requires_remote_budget_and_prices(core):
    core.settings.mode = 'automatic'
    core.providers.configs['openai'].enabled = True
    core.providers.configs['openai'].model = 'gpt-test'
    core.providers.secrets['openai'] = 'test'
    with pytest.raises(ValueError):
        core.choose()
    core.settings.daily_budget = 1
    core.providers.configs['openai'].input_price = 1
    core.providers.configs['openai'].output_price = 1
    core.providers.configs['openai'].price_date = '2026-10-29'
    assert core.choose() == ['openai']
    core.store.add_usage('openai', 'gpt-test', 0, 0, 2)
    with pytest.raises(ValueError, match='orçamento'):
        core.check_budget('openai', [], [])


def test_http_and_websocket_require_parent_authorization(tmp_path):
    core = Core(tmp_path)
    app = create_app(core, 'test-token')
    with TestClient(app) as client:
        assert client.get('/health').status_code == 401
        assert client.get('/health', headers={'Authorization': 'Bearer wrong'}).status_code == 401
        headers = {'Authorization': 'Bearer test-token'}
        assert client.get('/health', headers=headers).status_code == 200
        assert client.get('/health', headers=headers | {'Origin': 'https://evil.test'}).status_code == 401
        response = client.post('/action', headers=headers, json={'type': 'snapshot'})
        assert response.status_code == 200 and response.json()['session_id']
        assert client.post('/action', headers=headers, json={'type': 'shell'}).status_code == 400
        with client.websocket_connect('/events', headers=headers) as ws:
            assert ws.receive_json()['type'] == 'core.connected'


async def test_slow_event_consumer_is_disconnected_instead_of_losing_approval(core):
    queue = asyncio.Queue(maxsize=1)
    core.bus.clients.add(queue)
    await core.bus.emit('first')
    await core.bus.emit('approval.required')
    assert queue not in core.bus.clients
    assert await queue.get() is None


async def test_hardware_action_runs_without_ai(core):
    core.telemetry = core.collector.sample()
    run = await core.action(Action(type='tool', tool='hardware'))
    task = core.tasks[run['run_id']]
    await task
    assert core.runs[run['run_id']]['state'] == 'completed'
    assert 'ram_total' in core.store.messages()[-1]['content']
