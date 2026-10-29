import asyncio
import json
import httpx
import pytest
from services.core.contracts import Action
from services.core.orchestration import Core


def make_core(tmp_path, response):
    return Core(tmp_path, httpx.MockTransport(response))


async def test_semantic_memory_uses_only_local_model_and_excludes_expired_or_deleted(tmp_path):
    requests = []
    def respond(request):
        requests.append(str(request.url))
        if request.method == 'GET':
            return httpx.Response(200, json={'models': [{'key': 'local-embed', 'type': 'embedding', 'loaded_instances': [{'id': 'local-embed'}]}]})
        data = json.loads(request.content)
        vectors = [[1, 0] if 'português' in text else [0, 1] for text in data['input']]
        return httpx.Response(200, json={'data': [{'index': i, 'embedding': v} for i, v in enumerate(vectors)]})
    core = make_core(tmp_path, respond)
    core.settings.local_only = True
    core.settings.embedding_model = 'local-embed'
    core.settings.semantic_memory_enabled = True
    first = core.store.remember('Prefiro português')
    second = core.store.remember('Gosto de matemática')
    assert (await core.memory_index.index())['indexed'] == 2
    found = await core.memory_index.search('português')
    assert found[0]['id'] == first and found[0]['score'] == 1
    core.store.forget(first)
    assert all(m['id'] != first for m in await core.memory_index.search('português'))
    assert all('127.0.0.1:1234' in url for url in requests)
    await core.stop()


async def test_memory_edits_invalidate_old_vectors(tmp_path):
    core = make_core(tmp_path, lambda r: httpx.Response(200, json={'models': [{'key': 'local-embed', 'type': 'embedding', 'loaded_instances': [{'id': 'local-embed'}]}]} if r.method == 'GET' else {'data': [{'index': 0, 'embedding': [1, 0]}]}))
    core.settings.embedding_model = 'local-embed'; core.settings.semantic_memory_enabled = True
    key = core.store.remember('Original')
    await core.memory_index.index()
    core.store.remember('Edited', key)
    assert (await core.memory_index.search('test'))[0]['content'] == 'Edited'
    await core.stop()


async def test_local_ollama_embedding_rejects_cloud_route(tmp_path):
    requests = []
    def respond(request):
        requests.append(str(request.url))
        return httpx.Response(200, json={'remote_model': 'remote'})
    core = make_core(tmp_path, respond)
    core.settings.embedding_provider = 'ollama'; core.settings.embedding_model = 'embed'
    core.store.remember('Private')
    with pytest.raises(ValueError):
        await core.memory_index.index()
    assert len(requests) == 1 and requests[0].endswith('/show')
    await core.stop()


async def test_natural_tool_call_round_trip_is_audited(tmp_path):
    count = 0
    def respond(request):
        nonlocal count
        if request.method == 'GET':
            return httpx.Response(200, json={'models': [{'key': 'local', 'type': 'llm', 'loaded_instances': [{'id': 'local'}], 'capabilities': {'trained_for_tool_use': True}}]})
        count += 1
        if count == 1:
            chunks = [ {'choices': [{'delta': {'tool_calls': [{'index': 0, 'id': 'call1', 'function': {'name': 'hardware', 'arguments': '{}'}}]}}]} ]
        else:
            body = json.loads(request.content)
            assert body['messages'][-1]['role'] == 'tool'
            assert 'ram_total' in body['messages'][-1]['content']
            chunks = [{'choices': [{'delta': {'content': 'Aqui estão os dados reais.'}}]}]
        return httpx.Response(200, text='\n\n'.join('data: ' + json.dumps(c) for c in chunks) + '\n\n')
    core = make_core(tmp_path, respond)
    core.providers.configs['lmstudio'].model = 'local'
    core.telemetry = core.collector.sample()
    result = core.start_run('Como está o computador?')
    await core.tasks[result['run_id']]
    assert core.runs[result['run_id']]['state'] == 'completed'
    assert count == 2
    assert core.store.messages()[-1]['content'] == 'Aqui estão os dados reais.'
    await core.stop()


async def test_collaboration_is_bounded_and_no_participant_gets_tools(tmp_path):
    requests = []
    def respond(request):
        if request.method == 'GET':
            return httpx.Response(200, json={'models': [{'key': 'model-a', 'type': 'llm', 'loaded_instances': [{'id': 'model-a'}]}]})
        body = json.loads(request.content)
        if request.url.path.endswith('/show'):
            return httpx.Response(200, json={'model_info': {'local': True}})
        requests.append(body)
        assert 'tools' not in body
        if str(request.url).endswith('/chat'):
            return httpx.Response(200, text=json.dumps({'message': {'content': 'Análise local'}, 'done': True}) + '\n')
        return httpx.Response(200, text='data: ' + json.dumps({'choices': [{'delta': {'content': 'Síntese local'}}]}) + '\n\n')
    core = make_core(tmp_path, respond)
    core.settings.mode = 'collaborative'
    core.providers.configs['lmstudio'].model = 'model-a'
    core.providers.configs['ollama'].model = 'model-b'
    result = core.start_run('Compare as opções')
    await core.tasks[result['run_id']]
    assert core.runs[result['run_id']]['state'] == 'completed'
    assert len(requests) == 3  # Two participants, one consolidation.
    await core.stop()


async def test_provider_failure_does_not_retry_another_model(tmp_path):
    requests = []
    core = make_core(tmp_path, lambda request: requests.append(str(request.url)) or httpx.Response(429, json={'error': 'limited'}))
    core.providers.configs['lmstudio'].model = 'fixed'
    result = core.start_run('Olá')
    await core.tasks[result['run_id']]
    assert core.runs[result['run_id']]['state'] == 'error'
    assert len(requests) == 1 and '1234' in requests[0]
    await core.stop()


async def test_privacy_setting_change_cancels_inflight_generation(tmp_path):
    core = Core(tmp_path)
    async def long_generation(*args, **kwargs):
        await asyncio.sleep(100)
        yield {'type': 'text', 'text': 'must not arrive'}
    core.providers.stream = long_generation
    core.providers.configs['lmstudio'].model = 'local'
    result = core.start_run('Olá')
    await asyncio.sleep(.01)
    await core.action(Action(type='settings', settings={'local_only': True}))
    assert not core.tasks
    assert core.runs[result['run_id']]['state'] == 'idle'
    assert core.settings.local_only
    await core.stop()


async def test_fragmented_credential_never_reaches_renderer(tmp_path):
    core = Core(tmp_path)
    secret = 'credential-example-that-must-stay-private'
    core.providers.secrets['lmstudio'] = secret
    core.providers.configs['lmstudio'].model = 'local'
    async def malicious_stream(*args, **kwargs):
        for char in secret:
            yield {'type': 'text', 'text': char}
    core.providers.stream = malicious_stream
    queue = asyncio.Queue(maxsize=500)
    core.bus.clients.add(queue)
    result = core.start_run('Olá')
    await core.tasks[result['run_id']]
    emitted = []
    while not queue.empty():
        emitted.append(queue.get_nowait())
    assert secret not in json.dumps(emitted)
    assert secret not in json.dumps(core.store.export())
    assert all(not e['payload']['content'] for e in emitted if e['type'] == 'message.delta')
    await core.stop()


async def test_switch_to_local_cancels_concurrent_discovery_and_voice_download(tmp_path):
    core = Core(tmp_path)
    async def wait_forever(*args):
        await asyncio.sleep(100)
    core.providers.discover = wait_forever
    core.voice.prepare = wait_forever
    discovery = asyncio.create_task(core.action(Action(type='models', provider='openai')))
    download = asyncio.create_task(core.action(Action(type='voice_prepare')))
    await asyncio.sleep(.01)
    await core.action(Action(type='settings', settings={'local_only': True}))
    assert discovery.cancelled() and download.cancelled()
    assert core.settings.local_only and not core.operations
    await core.stop()


async def test_events_remove_secrets_before_delivery(tmp_path):
    core = Core(tmp_path)
    core.providers.secrets['openai'] = 'secret-fixture-value'
    queue = asyncio.Queue(maxsize=5); core.bus.clients.add(queue)
    await core.bus.emit('test', {'content': 'secret-fixture-value'})
    assert 'secret-fixture-value' not in json.dumps(await queue.get())
    with pytest.raises(ValueError, match='credencial'):
        core.tools.validate('write_file', {'path': str(tmp_path / 'blocked.txt'), 'content': 'secret-fixture-value'})
    await core.stop()
