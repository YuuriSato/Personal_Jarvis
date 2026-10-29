import json
import httpx
import pytest
from services.core.providers import Providers, ProviderError, sse


def encoded(items):
    return '\n\n'.join('data: ' + json.dumps(item) for item in items) + '\n\n'


CASES = {
    'openai': [
        {'type': 'response.output_text.delta', 'delta': 'Olá'},
        {'type': 'response.output_item.done', 'item': {'type': 'function_call', 'call_id': 'call1', 'name': 'hardware', 'arguments': '{}'}},
        {'type': 'response.completed', 'response': {'usage': {'input_tokens': 4, 'output_tokens': 2}, 'output': []}},
    ],
    'claude': [
        {'type': 'message_start', 'message': {'usage': {'input_tokens': 4}}},
        {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'Olá'}},
        {'type': 'content_block_start', 'index': 1, 'content_block': {'type': 'tool_use', 'id': 'call1', 'name': 'hardware'}},
        {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'input_json_delta', 'partial_json': '{}'}},
        {'type': 'message_delta', 'usage': {'output_tokens': 2}},
    ],
    'gemini': [
        {'candidates': [{'content': {'parts': [{'text': 'Olá'}]}}]},
        {'candidates': [{'content': {'parts': [{'functionCall': {'name': 'hardware', 'args': {}}, 'thoughtSignature': 'signature'}]}}], 'usageMetadata': {'promptTokenCount': 4, 'candidatesTokenCount': 2}},
    ],
    'lmstudio': [
        {'choices': [{'delta': {'content': 'Olá'}}]},
        {'choices': [{'delta': {'tool_calls': [{'index': 0, 'id': 'call1', 'function': {'name': 'hardware', 'arguments': '{'}}]}}]},
        {'choices': [{'delta': {'tool_calls': [{'index': 0, 'function': {'arguments': '}'}}]}}]},
        {'choices': [], 'usage': {'prompt_tokens': 4, 'completion_tokens': 2}},
    ],
    'ollama': [
        {'message': {'content': 'Olá'}},
        {'message': {'tool_calls': [{'function': {'name': 'hardware', 'arguments': {}}}]}},
        {'done': True, 'prompt_eval_count': 4, 'eval_count': 2},
    ],
}


@pytest.mark.parametrize('key', CASES)
async def test_native_adapters_normalize_text_tools_and_usage(key):
    requests = []
    def respond(request):
        requests.append(request)
        if key == 'lmstudio' and request.method == 'GET':
            return httpx.Response(200, json={'models': [{'key': 'test-model', 'type': 'llm', 'loaded_instances': [{'id': 'test-model'}], 'capabilities': {'trained_for_tool_use': True}}]})
        if request.url.path.endswith('/show'):
            return httpx.Response(200, json={'model_info': {'local': True}})
        body = '\n'.join(json.dumps(i) for i in CASES[key]) if key == 'ollama' else encoded(CASES[key])
        return httpx.Response(200, text=body)
    p = Providers(transport=httpx.MockTransport(respond))
    p.configs[key].enabled = True
    p.secrets[key] = 'test-key'
    chunks = [c async for c in p.stream(key, 'test-model', [{'role': 'system', 'content': 'System'}, {'role': 'user', 'content': 'Hello'}], [], 128)]
    assert ''.join(c['text'] for c in chunks if c['type'] == 'text') == 'Olá'
    assert next(c for c in chunks if c['type'] == 'tool')['name'] == 'hardware'
    assert next(c for c in chunks if c['type'] == 'tool')['arguments'] == {}
    assert any(c['type'].startswith('usage') for c in chunks)
    assert len(requests) == (2 if key in ('ollama', 'lmstudio') else 1)
    assert b'test-key' not in requests[0].content
    if key == 'openai':
        assert requests[0].url.path.endswith('/responses')
        assert json.loads(requests[0].content)['store'] is False
    if key == 'gemini':
        context = next(c for c in chunks if c['type'] == 'context')
        assert context['parts'][-1]['thoughtSignature'] == 'signature'


@pytest.mark.parametrize('status', [400, 401, 403, 404, 429, 500])
async def test_upstream_error_body_never_leaks(status):
    p = Providers(transport=httpx.MockTransport(lambda r: httpx.Response(status, text='secret-should-not-leak')))
    p.configs['openai'].enabled = True
    p.secrets['openai'] = 'test'
    with pytest.raises(ProviderError) as error:
        async for _ in p.stream('openai', 'test', [], [], 128):
            pass
    assert 'secret-should-not-leak' not in str(error.value)


async def test_sse_handles_comments_multiline_and_done():
    text = ': comment\ndata: {"type":\ndata: "test"}\n\ndata: [DONE]\n\n'
    assert [v async for v in sse(httpx.Response(200, text=text))] == [{'type': 'test'}]


def test_native_conversation_formats_preserve_tool_results_and_signatures():
    history = [
        {'role': 'user', 'content': 'Check hardware'},
        {'role': 'assistant', 'content': '', 'calls': [{'id': '1', 'name': 'hardware', 'arguments': {}}], '_parts': [{'functionCall': {'name': 'hardware', 'args': {}}, 'thoughtSignature': 'signed'}]},
        {'role': 'tool', 'content': '{"cpu": 10}', 'name': 'hardware', 'tool_call_id': '1'},
    ]
    assert Providers.openai_input(history)[-1]['type'] == 'function_call_output'
    assert Providers.claude_input(history)[-1]['content'][0]['type'] == 'tool_result'
    assert Providers.gemini_input(history)[1]['parts'][0]['thoughtSignature'] == 'signed'


def test_remote_urls_cannot_be_replaced_to_exfiltrate_credentials():
    p = Providers()
    with pytest.raises(ValueError):
        p.configure('openai', {'base_url': 'https://evil.test'})
    with pytest.raises(ValueError):
        p.configure('lmstudio', {'base_url': 'http://evil.test/v1'})
