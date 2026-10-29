import asyncio
import json
import sys
from types import SimpleNamespace

import httpx
import pytest

from services.core.contracts import Action
from services.core.orchestration import Core
from services.core.voice import Voice
from services.core.weather import search_city


async def test_city_search_and_weather_have_real_source_and_translated_condition(tmp_path):
    requested = []
    def respond(request):
        requested.append(request)
        if request.url.host == 'geocoding-api.open-meteo.com':
            return httpx.Response(200, json={'results': [{'name': 'Osasco', 'admin1': 'São Paulo', 'country': 'Brasil', 'latitude': -23.53, 'longitude': -46.79}]})
        return httpx.Response(200, json={'current': {'temperature_2m': 24.5, 'weather_code': 3}})
    core = Core(tmp_path, httpx.MockTransport(respond))
    city = (await core.action(Action(type='weather_search', text='Osasco, SP')))['cities'][0]
    assert city['region'] == 'São Paulo'
    await core.action(Action(type='settings', settings={'city': 'Osasco, SP', 'latitude': city['latitude'], 'longitude': city['longitude'], 'weather_enabled': True}))
    weather = await core.action(Action(type='weather_refresh'))
    assert weather['temperature'] == 24.5 and weather['description'] == 'Nublado'
    assert weather['source'] == 'Open-Meteo' and weather['timestamp']
    assert requested[0].url.params['name'] == 'Osasco, SP'
    await core.stop()


async def test_offline_mode_blocks_new_network_actions(tmp_path):
    requests = []
    core = Core(tmp_path, httpx.MockTransport(lambda request: requests.append(request) or httpx.Response(500)))
    core.settings.local_only = True
    for action in [Action(type='weather_search', text='City'), Action(type='voice_prepare_tts'), Action(type='voice_prepare_wake')]:
        with pytest.raises(ValueError):
            await core.action(action)
    assert requests == []
    await core.stop()


async def test_city_search_rejects_short_or_oversized_query_without_network():
    for query in ['', 'x', 'x'*121]:
        with pytest.raises(ValueError):
            await search_city(query)


async def test_wake_word_requires_two_frames_and_resets_after_detection(tmp_path, monkeypatch):
    voice = Voice(tmp_path)
    scores = iter([.7, .2, .7, .8])
    resets = []
    voice.wake = SimpleNamespace(predict=lambda _: {'hey_jarvis': next(scores)}, reset=lambda: resets.append(True))
    assert not await voice.wake_audio([0]*1280)
    assert not await voice.wake_audio([0]*1280)
    assert not await voice.wake_audio([0]*1280)
    assert await voice.wake_audio([0]*1280)
    assert resets == [True] and voice.wake_hits == 0


async def test_unprepared_wake_word_is_not_reported_as_listening(tmp_path):
    voice = Voice(tmp_path)
    with pytest.raises(ValueError, match='Prepare'):
        await voice.wake_audio([0]*1280)
    assert not voice.status()['wake_model_ready']


async def test_single_local_model_collaboration_exposes_roles_honestly(tmp_path):
    calls = []
    core = Core(tmp_path)
    core.settings.mode = 'collaborative'
    core.providers.configs['lmstudio'].model = 'one-model'
    async def generated(run_id, provider, messages, tools, show=True):
        calls.append((provider, messages, tools, show))
        return {'role': 'assistant', 'content': 'Análise ou síntese local.', 'calls': []}
    core.generate = generated
    queue = asyncio.Queue(maxsize=50); core.bus.clients.add(queue)
    rid = core.start_run('Compare duas alternativas.')['run_id']
    await core.tasks[rid]
    assert len(calls) == 3 and all(c[0] == 'lmstudio' and c[2] == [] for c in calls)
    roles = []
    while not queue.empty():
        event = queue.get_nowait()
        if event['type'] == 'run.collaborator':
            roles.append(event['payload'])
    assert {r['role'] for r in roles} == {'analista', 'revisor crítico'}
    assert all(r['distinct_models'] == 1 for r in roles)
    await core.stop()


async def test_tts_error_is_a_voice_event_and_does_not_claim_success(tmp_path):
    core = Core(tmp_path)
    async def fail(*args):
        raise ValueError('Dispositivo indisponível')
    core.voice.speak = fail
    queue = asyncio.Queue(maxsize=10); core.bus.clients.add(queue)
    await core.speak('Teste')
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    assert any(e['type'] == 'voice.failed' and 'indisponível' in e['payload']['message'] for e in events)
    assert events[-1]['payload']['state'] == 'idle'
    await core.stop()
