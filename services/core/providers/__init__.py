"""Native provider adapters. HTTP responses are never treated as execution authority."""
import json
import re
from urllib.parse import quote, urlsplit
import httpx
from ..contracts import ProviderConfig, DEFAULT_URLS

NAMES = {'openai': 'OpenAI', 'gemini': 'Gemini', 'claude': 'Claude', 'lmstudio': 'LM Studio', 'ollama': 'Ollama'}


class ProviderError(ValueError):
    pass


async def sse(response):
    """Handle fragmented transport, multiline SSE, comments and termination."""
    lines = []
    async for line in response.aiter_lines():
        if not line:
            if lines:
                data = '\n'.join(lines)
                lines = []
                if data == '[DONE]':
                    return
                yield json.loads(data)
        elif line.startswith('data:'):
            lines.append(line[5:].lstrip(' '))
    if lines:
        data = '\n'.join(lines)
        if data != '[DONE]':
            yield json.loads(data)


def check_response(response):
    if response.is_error:
        # Never relay an upstream error body: it can contain credentials/content.
        hints = {401: 'Credencial inválida.', 403: 'Acesso negado.', 404: 'Modelo ou endpoint indisponível.',
                 429: 'Limite do provedor atingido.', 400: 'Pedido incompatível com o modelo ou suas capacidades.'}
        raise ProviderError(hints.get(response.status_code, f'Provedor respondeu HTTP {response.status_code}.'))


class Providers:
    def __init__(self, saved=None, transport=None):
        self.configs = {key: ProviderConfig(id=key, name=NAMES[key], local=key in ('lmstudio', 'ollama'),
                        base_url=DEFAULT_URLS[key], enabled=key in ('lmstudio', 'ollama')) for key in NAMES}
        for key, value in (saved or {}).items():
            if key in self.configs:
                self.configs[key] = ProviderConfig(**value).checked()
        self.secrets = {}
        self.models = {key: [] for key in NAMES}
        self.status = {key: 'not_validated' for key in NAMES}
        self.transport = transport

    def redact(self, value):
        text = str(value)
        for secret in self.secrets.values():
            if secret:
                text = text.replace(secret, '[CREDENCIAL REMOVIDA]')
        return re.sub(r'\b(?:sk-[A-Za-z0-9_\-]{12,}|AIza[A-Za-z0-9_\-]{20,})\b', '[CREDENCIAL REMOVIDA]', text)

    def public(self):
        return [p.model_dump() | {'models': self.models[key], 'status': self.status[key],
                                 'has_key': bool(self.secrets.get(key))} for key, p in self.configs.items()]

    def save(self):
        return {k: p.model_dump() for k, p in self.configs.items()}

    def configure(self, key, values):
        permitted = {'enabled', 'base_url', 'model', 'input_price', 'output_price', 'price_date'}
        if set(values) - permitted:
            raise ValueError('Campo de configuração não permitido.')
        previous = self.configs[key]
        if 'model' in values and values['model'] != previous.model:
            values = {'input_price': None, 'output_price': None, 'price_date': ''} | values
        self.configs[key] = ProviderConfig(**(previous.model_dump() | values)).checked()
        self.status[key] = 'not_validated'

    def gate(self, key, local_only):
        p = self.configs[key].checked()
        if not p.enabled:
            raise ProviderError('Habilite o provedor nas configurações.')
        if local_only and not p.local:
            raise ProviderError('Modo somente local: envio para nuvem bloqueado.')
        if not p.local and not self.secrets.get(key):
            raise ProviderError('Cadastre a API key no cofre do aplicativo desktop.')
        return p

    def headers(self, key):
        if key == 'gemini':
            return {'x-goog-api-key': self.secrets.get(key, '')}
        if key == 'claude':
            return {'x-api-key': self.secrets.get(key, ''), 'anthropic-version': '2023-06-01'}
        return {'Authorization': f'Bearer {self.secrets[key]}'} if self.secrets.get(key) else {}

    def client(self, key):
        return httpx.AsyncClient(headers=self.headers(key), timeout=httpx.Timeout(90, connect=4),
                                 transport=self.transport, follow_redirects=False, trust_env=False)

    async def discover(self, key, local_only=False):
        p = self.gate(key, local_only)
        try:
            if key == 'lmstudio':
                models = await self.lmstudio_models()
                self.models[key] = models
                self.status[key] = 'connected'
                return models
            async with self.client(key) as client:
                response = await client.get(p.base_url + ('/tags' if key == 'ollama' else '/models'), timeout=8)
                check_response(response)
                data = response.json()
            items = data.get('models' if key in ('gemini', 'ollama') else 'data', [])
            models = []
            for item in items:
                mid = item.get('id') or item.get('name', '')
                if key == 'gemini':
                    if 'generateContent' not in item.get('supportedGenerationMethods', []):
                        continue
                    mid = mid.removeprefix('models/')
                if key == 'openai' and not mid.startswith(('gpt-', 'o1', 'o3', 'o4', 'chatgpt-')):
                    continue
                if key == 'openai' and any(v in mid for v in ('audio', 'realtime', 'transcribe', 'tts', 'image', 'search')):
                    continue
                cloud = key == 'ollama' and (bool(item.get('remote_host')) or 'cloud' in mid.lower())
                caps = ['text', 'streaming']
                if not p.local:
                    caps.append('tools')
                models.append({'id': mid, 'name': item.get('displayName') or item.get('display_name') or mid,
                               'capabilities': caps, 'cloud': cloud})
            self.models[key] = models
            self.status[key] = 'connected'
            return models
        except Exception:
            self.status[key] = 'unavailable'
            raise

    def lmstudio_origin(self):
        url = urlsplit(self.configs['lmstudio'].checked().base_url)
        return f'{url.scheme}://{url.netloc}'

    async def lmstudio_models(self):
        """Use native metadata, with read-only fallbacks for older LM Studio versions."""
        async with self.client('lmstudio') as client:
            for api in ('v1', 'v0', 'compat'):
                endpoint = (self.configs['lmstudio'].base_url + '/models') if api == 'compat' else self.lmstudio_origin() + f'/api/{api}/models'
                response = await client.get(endpoint, timeout=8)
                if response.status_code in (404, 405) and api != 'compat':
                    continue
                check_response(response)
                data = response.json()
                rows = data.get('models' if api == 'v1' else 'data', [])
                models = []
                for row in rows:
                    mid = row.get('key') if api == 'v1' else row.get('id')
                    if not mid:
                        continue
                    kind = row.get('type', 'unknown')
                    if kind in ('vlm', 'llm'):
                        kind = 'llm'
                    elif kind in ('embedding', 'embeddings') or (api == 'compat' and 'embed' in mid.lower()):
                        kind = 'embedding'
                    caps = row.get('capabilities', {})
                    tools = (caps.get('trained_for_tool_use', False) if isinstance(caps, dict) else 'tool_use' in caps)
                    vision = (caps.get('vision', False) if isinstance(caps, dict) else row.get('type') == 'vlm')
                    capabilities = ['embeddings'] if kind == 'embedding' else ['text', 'streaming']
                    if tools:
                        capabilities.append('tools')
                    if vision:
                        capabilities.append('vision')
                    instances = row.get('loaded_instances', [])
                    loaded = 'loaded' if instances or row.get('state') == 'loaded' else 'unloaded' if api != 'compat' else 'unknown'
                    instance_ids = [instance['id'] for instance in instances if instance.get('id')]
                    models.append({'id': mid, 'name': row.get('display_name') or mid, 'kind': kind,
                                   'capabilities': capabilities, 'state': loaded, 'instance_ids': instance_ids,
                                   'size_bytes': row.get('size_bytes'), 'context_length': row.get('max_context_length'),
                                   'loaded_context_length': instances[0].get('config', {}).get('context_length') if instances else None,
                                   'metadata_source': f'lmstudio_{api}', 'cloud': False})
                return models
        return []

    async def load_lmstudio(self, model):
        self.gate('lmstudio', True)
        models = await self.discover('lmstudio', True)
        selected = next((m for m in models if m['id'] == model), None)
        if not selected:
            raise ProviderError('Selecione um modelo já baixado no LM Studio.')
        if selected['state'] == 'loaded':
            return {'status': 'loaded', 'instance_id': (selected['instance_ids'] or [model])[0]}
        if selected['metadata_source'] != 'lmstudio_v1':
            raise ProviderError('Esta versão do LM Studio não oferece carregamento pela API v1. Carregue o modelo no LM Studio e consulte novamente.')
        body = {'model': model}
        if selected['kind'] != 'embedding':
            body.update(context_length=4096, eval_batch_size=256, offload_kv_cache_to_gpu=False)
        async with self.client('lmstudio') as client:
            response = await client.post(self.lmstudio_origin() + '/api/v1/models/load', json=body, timeout=120)
            check_response(response)
            result = response.json()
        await self.discover('lmstudio', True)
        if result.get('status') != 'loaded':
            raise ProviderError('O LM Studio não confirmou o carregamento. Consulte o estado do servidor.')
        return {'status': 'loaded', 'instance_id': result.get('instance_id', model)}

    async def lmstudio_model(self, model):
        models = await self.discover('lmstudio', True)
        selected = next((m for m in models if m['id'] == model or model in m.get('instance_ids', [])), None)
        if not selected:
            raise ProviderError('O modelo selecionado não está disponível no LM Studio. Consulte os modelos novamente.')
        if selected.get('kind') in ('embedding', 'decision'):
            raise ProviderError('Um modelo de embeddings ou decisão não pode ser usado para conversar.')
        if selected.get('state') == 'unloaded':
            raise ProviderError('O modelo está baixado, mas não carregado. Use Carregar modelo nas configurações do LM Studio no JARVIS.')
        return selected

    async def ensure_local_model(self, key, model, local_only):
        # Ollama can route cloud models through localhost. Loopback alone is insufficient.
        if key != 'ollama':
            return
        if 'cloud' in model.lower():
            raise ProviderError('Ollama em nuvem não é habilitado por este hub. Use um provedor remoto explicitamente configurado.')
        p = self.configs[key]
        async with self.client(key) as client:
            response = await client.post(p.base_url + '/show', json={'model': model})
            check_response(response)
            data = response.json()
            if data.get('remote_host') or data.get('remote_model'):
                raise ProviderError('Roteamento Ollama para nuvem bloqueado. Apenas modelos locais são permitidos neste adaptador.')

    async def stream(self, key, model, messages, tools, max_tokens, local_only=False):
        p = self.gate(key, local_only)
        await self.ensure_local_model(key, model, local_only)
        if not model:
            raise ProviderError('Selecione um modelo disponível nas configurações.')
        lm_model = await self.lmstudio_model(model) if key == 'lmstudio' else None
        if lm_model:
            if lm_model.get('metadata_source') != 'lmstudio_compat' and 'tools' not in lm_model['capabilities']:
                tools = []
            model = (lm_model.get('instance_ids') or [model])[0]
        if key == 'openai':
            body = {'model': model, 'input': self.openai_input(messages), 'stream': True,
                    'max_output_tokens': max_tokens, 'store': False, 'include': ['reasoning.encrypted_content']}
            if tools:
                body['tools'] = [dict(type='function', **t) for t in tools]
            path = '/responses'
        elif key == 'claude':
            body = {'model': model, 'max_tokens': max_tokens, 'stream': True,
                    'system': messages[0]['content'], 'messages': self.claude_input(messages[1:])}
            if tools:
                body['tools'] = [{'name': t['name'], 'description': t['description'], 'input_schema': t['parameters']} for t in tools]
            path = '/messages'
        elif key == 'gemini':
            body = {'systemInstruction': {'parts': [{'text': messages[0]['content']}]},
                    'contents': self.gemini_input(messages[1:]), 'generationConfig': {'maxOutputTokens': max_tokens}}
            if tools:
                body['tools'] = [{'functionDeclarations': [{**t, 'parameters': {k: v for k, v in t['parameters'].items() if k != 'additionalProperties'}} for t in tools]}]
            path = '/models/' + quote(model, safe='') + ':streamGenerateContent?alt=sse'
        else:
            body = {'model': model, 'messages': self.chat_input(messages), 'stream': True}
            if tools:
                body['tools'] = [{'type': 'function', 'function': t} for t in tools]
            path = '/chat' if key == 'ollama' else '/chat/completions'
            if key == 'ollama':
                body['options'] = {'num_predict': max_tokens}
                for message in body['messages']:
                    for call in message.get('tool_calls', []):
                        call['function']['arguments'] = json.loads(call['function']['arguments'])
            else:
                body.update(max_tokens=max_tokens, stream_options={'include_usage': True})
        calls = {}
        gemini_parts = []
        claude_input_tokens = 0
        async with self.client(key) as client:
            async with client.stream('POST', p.base_url + path, json=body) as response:
                check_response(response)
                if key == 'ollama':
                    async def chunks():
                        async for line in response.aiter_lines():
                            if line:
                                yield json.loads(line)
                    iterator = chunks()
                else:
                    iterator = sse(response)
                async for item in iterator:
                    if item.get('error') or item.get('type') == 'error':
                        raise ProviderError('O provedor interrompeu a geração.')
                    if key == 'openai':
                        kind = item.get('type')
                        if kind in ('response.output_text.delta', 'response.refusal.delta'):
                            yield {'type': 'text', 'text': item['delta']}
                        elif kind == 'response.output_item.done':
                            obj = item['item']
                            if obj.get('type') == 'function_call':
                                calls[obj['call_id']] = dict(id=obj['call_id'], name=obj['name'], arguments=obj['arguments'])
                        elif kind == 'response.completed':
                            result = item['response']
                            yield {'type': 'context', 'items': result.get('output', [])}
                            usage = result.get('usage', {})
                            yield {'type': 'usage', 'input_tokens': usage.get('input_tokens', 0), 'output_tokens': usage.get('output_tokens', 0)}
                        elif kind in ('response.failed', 'response.incomplete'):
                            raise ProviderError('Geração incompleta; reduza a tarefa ou ajuste o limite de saída.')
                    elif key == 'claude':
                        kind = item.get('type')
                        if kind == 'content_block_start' and item['content_block']['type'] == 'tool_use':
                            obj = item['content_block']
                            calls[item['index']] = dict(id=obj['id'], name=obj['name'], arguments='')
                        elif kind == 'content_block_delta':
                            delta = item['delta']
                            if delta['type'] == 'text_delta':
                                yield {'type': 'text', 'text': delta['text']}
                            elif delta['type'] == 'input_json_delta':
                                calls[item['index']]['arguments'] += delta['partial_json']
                        elif kind == 'message_start':
                            claude_input_tokens = item['message'].get('usage', {}).get('input_tokens', 0)
                            yield {'type': 'usage_total', 'input_tokens': claude_input_tokens, 'output_tokens': 0}
                        elif kind == 'message_delta':
                            yield {'type': 'usage_total', 'input_tokens': claude_input_tokens, 'output_tokens': item.get('usage', {}).get('output_tokens', 0)}
                    elif key == 'gemini':
                        for candidate in item.get('candidates', []):
                            for part in candidate.get('content', {}).get('parts', []):
                                gemini_parts.append(part)
                                if part.get('thought'):
                                    continue
                                if 'text' in part:
                                    yield {'type': 'text', 'text': part['text']}
                                elif 'functionCall' in part:
                                    fc = part['functionCall']
                                    cid = fc.get('id') or str(len(calls))
                                    calls[cid] = dict(id=cid, name=fc['name'], arguments=json.dumps(fc.get('args', {})))
                        if 'usageMetadata' in item:
                            u = item['usageMetadata']
                            yield {'type': 'usage_total', 'input_tokens': u.get('promptTokenCount', 0), 'output_tokens': u.get('candidatesTokenCount', 0)}
                    elif key == 'ollama':
                        message = item.get('message', {})
                        if message.get('content'):
                            yield {'type': 'text', 'text': message['content']}
                        for call in message.get('tool_calls', []):
                            fn = call['function']
                            idx = str(len(calls))
                            calls[idx] = dict(id=idx, name=fn['name'], arguments=json.dumps(fn.get('arguments', {})))
                        if item.get('done'):
                            yield {'type': 'usage', 'input_tokens': item.get('prompt_eval_count', 0), 'output_tokens': item.get('eval_count', 0)}
                    else:
                        for choice in item.get('choices', []):
                            delta = choice.get('delta', {})
                            if delta.get('content'):
                                yield {'type': 'text', 'text': delta['content']}
                            for call in delta.get('tool_calls', []):
                                obj = calls.setdefault(call['index'], dict(id='', name='', arguments=''))
                                obj['id'] += call.get('id', '')
                                obj['name'] += call.get('function', {}).get('name', '')
                                obj['arguments'] += call.get('function', {}).get('arguments', '')
                        if item.get('usage'):
                            u = item['usage']
                            yield {'type': 'usage', 'input_tokens': u.get('prompt_tokens', 0), 'output_tokens': u.get('completion_tokens', 0)}
        if gemini_parts:
            yield {'type': 'context', 'parts': gemini_parts}
        for call in calls.values():
            try:
                arguments = json.loads(call['arguments'] or '{}')
            except json.JSONDecodeError:
                raise ProviderError('Argumentos de ferramenta incompletos; nenhuma ação foi executada.')
            if not isinstance(arguments, dict):
                raise ProviderError('Argumentos de ferramenta inválidos.')
            yield dict(type='tool', **(call | {'arguments': arguments}))

    @staticmethod
    def chat_input(messages):
        result = []
        for m in messages:
            obj = {k: v for k, v in m.items() if k in ('role', 'content', 'tool_call_id', 'name')}
            if m.get('calls'):
                obj['tool_calls'] = [{'id': c['id'], 'type': 'function', 'function': {'name': c['name'], 'arguments': json.dumps(c['arguments'])}} for c in m['calls']]
            result.append(obj)
        return result

    @staticmethod
    def openai_input(messages):
        result = []
        for m in messages:
            if m['role'] == 'tool':
                result.append({'type': 'function_call_output', 'call_id': m['tool_call_id'], 'output': m['content']})
            elif m.get('_items'):
                result.extend(m['_items'])
            else:
                result.append({'role': m['role'], 'content': m['content']})
                for c in m.get('calls', []):
                    result.append({'type': 'function_call', 'call_id': c['id'], 'name': c['name'], 'arguments': json.dumps(c['arguments'])})
        return result

    @staticmethod
    def claude_input(messages):
        result = []
        for m in messages:
            if m['role'] == 'tool':
                obj = {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': m['tool_call_id'], 'content': m['content']}]}
            else:
                parts = [{'type': 'text', 'text': m['content']}] if m['content'] else []
                parts.extend({'type': 'tool_use', 'id': c['id'], 'name': c['name'], 'input': c['arguments']} for c in m.get('calls', []))
                obj = {'role': m['role'], 'content': parts}
            if result and result[-1]['role'] == obj['role']:
                result[-1]['content'].extend(obj['content'])
            else:
                result.append(obj)
        return result

    @staticmethod
    def gemini_input(messages):
        result = []
        for m in messages:
            if m['role'] == 'tool':
                obj = {'role': 'user', 'parts': [{'functionResponse': {'name': m['name'], 'response': {'result': m['content']}}}]}
            else:
                parts = m.get('_parts') or ([{'text': m['content']}] if m['content'] else [])
                if not m.get('_parts'):
                    parts = parts + [{'functionCall': {'name': c['name'], 'args': c['arguments']}} for c in m.get('calls', [])]
                obj = {'role': 'model' if m['role'] == 'assistant' else 'user', 'parts': parts}
            if result and result[-1]['role'] == obj['role']:
                result[-1]['parts'].extend(obj['parts'])
            else:
                result.append(obj)
        return result
