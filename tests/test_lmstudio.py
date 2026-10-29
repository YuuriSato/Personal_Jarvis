import json
import httpx
import pytest
from services.core.providers import Providers, ProviderError
from services.core.orchestration import Core
from services.core.contracts import Action


def catalog(loaded=False, tools=True):
    return {'models': [
        {'type': 'llm', 'key': 'local-assistant', 'display_name': 'Local Assistant', 'size_bytes': 1000000,
         'loaded_instances': [{'id': 'assistant-instance', 'config': {'context_length': 4096}}] if loaded else [],
         'capabilities': {'vision': True, 'trained_for_tool_use': tools}},
        {'type': 'embedding', 'key': 'local-embedding', 'display_name': 'Local Embedding', 'loaded_instances': []},
    ]}


async def test_native_catalog_distinguishes_capabilities_embeddings_and_loaded_state():
    requests = []
    p = Providers(transport=httpx.MockTransport(lambda r: requests.append(r) or httpx.Response(200, json=catalog())))
    models = await p.discover('lmstudio', True)
    assert requests[0].url.path == '/api/v1/models'
    assert models[0]['state'] == 'unloaded' and models[0]['kind'] == 'llm'
    assert models[0]['capabilities'] == ['text', 'streaming', 'tools', 'vision']
    assert models[1]['kind'] == 'embedding' and models[1]['capabilities'] == ['embeddings']
    assert all(r.method == 'GET' for r in requests)  # Discovery never loads or downloads.


async def test_fallback_to_v0_on_older_server():
    def respond(request):
        if request.url.path == '/api/v1/models':
            return httpx.Response(404)
        return httpx.Response(200, json={'data': [{'id': 'legacy', 'type': 'vlm', 'state': 'loaded', 'capabilities': ['tool_use']}]})
    p = Providers(transport=httpx.MockTransport(respond))
    model = (await p.discover('lmstudio'))[0]
    assert model['id'] == 'legacy' and model['state'] == 'loaded'
    assert 'tools' in model['capabilities'] and model['metadata_source'] == 'lmstudio_v0'


async def test_fallback_to_compatibility_preserves_unknown_state():
    requests = []
    def respond(request):
        requests.append(request.url.path)
        if request.url.path.startswith('/api/'):
            return httpx.Response(404)
        return httpx.Response(200, json={'data': [{'id': 'old-server'}]})
    p = Providers(transport=httpx.MockTransport(respond))
    model = (await p.discover('lmstudio'))[0]
    assert model['state'] == 'unknown' and model['metadata_source'] == 'lmstudio_compat'
    assert requests == ['/api/v1/models', '/api/v0/models', '/v1/models']


@pytest.mark.parametrize('status', [401, 403, 500])
async def test_native_auth_and_server_errors_are_not_bypassed_with_fallback(status):
    requests = []
    p = Providers(transport=httpx.MockTransport(lambda r: requests.append(r) or httpx.Response(status, text='secret error body')))
    with pytest.raises(ProviderError):
        await p.discover('lmstudio')
    assert len(requests) == 1


async def test_unloaded_model_cannot_trigger_automatic_load_via_chat():
    requests = []
    p = Providers(transport=httpx.MockTransport(lambda r: requests.append(r) or httpx.Response(200, json=catalog())))
    with pytest.raises(ProviderError, match='não carregado'):
        async for _ in p.stream('lmstudio', 'local-assistant', [], [], 128, True):
            pass
    assert all(r.method == 'GET' for r in requests)


async def test_embedding_model_is_not_a_conversation_model():
    p = Providers(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=catalog())))
    with pytest.raises(ProviderError, match='embeddings'):
        async for _ in p.stream('lmstudio', 'local-embedding', [], [], 128, True):
            pass


async def test_explicit_load_does_not_download_or_unload_other_models():
    loaded = False
    requests = []
    def respond(request):
        nonlocal loaded
        requests.append(request)
        if request.method == 'GET':
            return httpx.Response(200, json=catalog(loaded))
        assert request.url.path == '/api/v1/models/load'
        body = json.loads(request.content)
        assert body['model'] == 'local-assistant' and body['context_length'] == 4096
        loaded = True
        return httpx.Response(200, json={'status': 'loaded', 'instance_id': 'assistant-instance'})
    p = Providers(transport=httpx.MockTransport(respond))
    result = await p.load_lmstudio('local-assistant')
    assert result['instance_id'] == 'assistant-instance'
    assert p.models['lmstudio'][0]['state'] == 'loaded'
    assert len([r for r in requests if r.method == 'POST']) == 1


async def test_loaded_instance_id_and_real_tool_capability_are_respected():
    posted = []
    def respond(request):
        if request.method == 'GET':
            return httpx.Response(200, json=catalog(True, tools=False))
        posted.append(json.loads(request.content))
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"Olá"}}]}\n\n')
    p = Providers(transport=httpx.MockTransport(respond))
    chunks = [chunk async for chunk in p.stream('lmstudio', 'local-assistant', [], [{'name': 'hardware'}], 128, True)]
    assert chunks[0]['text'] == 'Olá'
    assert posted[0]['model'] == 'assistant-instance' and 'tools' not in posted[0]


async def test_explicit_load_through_core_updates_selection_and_audit(tmp_path):
    loaded = False
    def respond(request):
        nonlocal loaded
        if request.method == 'GET':
            return httpx.Response(200, json=catalog(loaded))
        loaded = True
        return httpx.Response(200, json={'status': 'loaded', 'instance_id': 'assistant-instance'})
    core = Core(tmp_path, httpx.MockTransport(respond))
    await core.action(Action(type='lmstudio_load', text='local-assistant'))
    assert core.providers.configs['lmstudio'].model == 'local-assistant'
    assert core.store.get('providers')['lmstudio']['model'] == 'local-assistant'
    assert any(row['kind'] == 'lmstudio.model_loaded' for row in core.store.export()['audit'])
    await core.stop()
