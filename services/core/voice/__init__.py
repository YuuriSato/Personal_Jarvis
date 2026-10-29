import asyncio
import importlib.util
import io
import json
import multiprocessing
from pathlib import Path
import wave
import httpx
import queue as queue_module
import sys


def make_worker(target, arguments, maxsize=0):
    if getattr(sys, 'frozen', False):
        from .worker_process import FrozenWorker, ResultQueue
        results = ResultQueue(maxsize=maxsize)
        return FrozenWorker(target.__name__, arguments, results), results
    context = multiprocessing.get_context('spawn')
    results = context.Queue(maxsize=maxsize)
    return context.Process(target=target, args=(*arguments, results), daemon=True), results


def synthesize_portuguese(text, model):
    """Return actual PCM audio; no network or microphone access."""
    from piper import PiperVoice
    voice = PiperVoice.load(str(model), use_cuda=False)
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as output:
        voice.synthesize_wav(text, output)
    return buffer.getvalue()


def speak_worker(text, model=None, events=None):
    if model:
        try:
            import numpy as np
            import sounddevice as sd
            data = synthesize_portuguese(text, model)
            with wave.open(io.BytesIO(data), 'rb') as wav:
                rate = wav.getframerate()
                with sd.RawOutputStream(samplerate=rate, channels=1, dtype='int16', blocksize=1024) as output:
                    while block := wav.readframes(1024):
                        rms = float(np.sqrt(np.mean((np.frombuffer(block, dtype=np.int16).astype(np.float32) / 32768) ** 2)))
                        try:
                            events.put_nowait({'amplitude': min(1, rms * 5)})
                        except queue_module.Full:
                            pass
                        output.write(block)
            events.put({'done': True})
        except Exception:
            events.put({'error': 'Não foi possível reproduzir a voz local em português. Verifique o dispositivo de saída.'})
        return
    import pyttsx3
    engine = pyttsx3.init()
    voices = engine.getProperty('voices')
    voice = next((v for v in voices if any('pt' in str(x).lower() or 'brazil' in str(x).lower() for x in [v.name, *v.languages])), None)
    if voice:
        engine.setProperty('voice', voice.id)
    engine.setProperty('rate', 175)
    engine.say(text)
    engine.runAndWait()
    engine.stop()


def transcribe_worker(audio, directory, result):
    try:
        import numpy as np
        from faster_whisper import WhisperModel
        model = WhisperModel(directory, device='cpu', compute_type='int8', cpu_threads=3, local_files_only=True)
        segments, _ = model.transcribe(np.asarray(audio, dtype=np.float32) / 32768, language='pt', vad_filter=True)
        result.put({'text': ' '.join(segment.text for segment in segments).strip()})
    except Exception:
        result.put({'error': 'Não foi possível transcrever o áudio localmente.'})


def download_worker(directory, result):
    try:
        from huggingface_hub import snapshot_download
        snapshot_download('Systran/faster-whisper-base', local_dir=directory, token=False)
        result.put({'ok': True})
    except Exception:
        result.put({'error': 'Não foi possível preparar o modelo de voz. Verifique a conexão e tente novamente.'})


class Voice:
    def __init__(self, directory):
        self.directory = directory / 'voice-model'
        self.wake_directory = directory / 'wake-models'
        self.tts_directory = directory / 'tts-pt-BR'
        self.speaker = None
        self.transcriber = None
        self.downloader = None
        self.wake = None
        self.wake_hits = 0
        self.tts_voices = []
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Speech\Voices\Tokens') as tokens:
                for index in range(winreg.QueryInfoKey(tokens)[0]):
                    with winreg.OpenKey(tokens, winreg.EnumKey(tokens, index) + r'\Attributes') as attributes:
                        name = winreg.QueryValueEx(attributes, 'Name')[0]
                        language = winreg.QueryValueEx(attributes, 'Language')[0]
                        self.tts_voices.append({'name': name, 'portuguese': any(v.lower() in ('416', '816') for v in language.split(';'))})
        except (ImportError, OSError):
            pass

    def status(self):
        available = importlib.util.find_spec('faster_whisper') is not None
        ready = all((self.directory / name).exists() for name in ('model.bin', 'config.json', 'tokenizer.json'))
        return {'available': available, 'model_ready': ready,
                'wake_available': importlib.util.find_spec('openwakeword') is not None,
                'wake_model_ready': self.wake_ready(),
                'tts_voices': self.tts_voices, 'tts_portuguese': self.piper_ready() or any(v['portuguese'] for v in self.tts_voices),
                'piper_ready': self.piper_ready(), 'tts_engine': 'piper' if self.piper_ready() else 'windows',
                'tts_name': 'Faber · Português do Brasil' if self.piper_ready() else 'Voz instalada no Windows',
                'reason': 'Pronto' if available and ready else 'Prepare o modelo local nas configurações de voz.'}

    async def prepare(self):
        if not self.status()['available']:
            raise ValueError('Instale as dependências opcionais de voz com npm run setup:voice.')
        process, queue = make_worker(download_worker, (str(self.directory),))
        self.downloader = process
        process.start()
        try:
            for _ in range(6000):
                if not queue.empty():
                    result = queue.get()
                    if result.get('error'):
                        raise ValueError(result['error'])
                    return self.status()
                if not process.is_alive():
                    raise ValueError('Preparação do modelo interrompida.')
                await asyncio.sleep(.1)
            raise ValueError('O download excedeu o tempo limite.')
        finally:
            if process.is_alive():
                process.terminate()
            await asyncio.to_thread(process.join, 3)
            queue.close()
            self.downloader = None
        return self.status()

    async def transcribe(self, audio, sample_rate):
        if sample_rate != 16000:
            raise ValueError('A transcrição aceita PCM mono de 16 kHz.')
        if not self.status()['model_ready'] or not self.status()['available']:
            raise ValueError(self.status()['reason'])
        process, queue = make_worker(transcribe_worker, (audio, str(self.directory)))
        self.transcriber = process
        process.start()
        try:
            for _ in range(1200):
                if not queue.empty():
                    result = queue.get()
                    if result.get('error'):
                        raise ValueError(result['error'])
                    return result['text']
                if not process.is_alive():
                    raise ValueError('O worker de voz foi encerrado.')
                await asyncio.sleep(.1)
            raise ValueError('A transcrição excedeu o tempo limite.')
        finally:
            if process.is_alive():
                process.terminate()
            await asyncio.to_thread(process.join, 3)
            queue.close()
            self.transcriber = None

    def piper_ready(self):
        return importlib.util.find_spec('piper') is not None and all((self.tts_directory / name).exists() for name in ('pt_BR-faber-medium.onnx', 'pt_BR-faber-medium.onnx.json'))

    async def prepare_tts(self):
        if importlib.util.find_spec('piper') is None:
            raise ValueError('Instale as dependências opcionais de voz para usar a fala em português.')
        self.tts_directory.mkdir(parents=True, exist_ok=True)
        base = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/'
        async with httpx.AsyncClient(timeout=180, follow_redirects=True, trust_env=False) as client:
            for name in ('MODEL_CARD', 'pt_BR-faber-medium.onnx.json', 'pt_BR-faber-medium.onnx'):
                target = self.tts_directory / name
                if target.exists():
                    continue
                temporary = target.with_suffix(target.suffix + '.download')
                async with client.stream('GET', base + name) as response:
                    response.raise_for_status()
                    total = 0
                    with temporary.open('wb') as output:
                        async for block in response.aiter_bytes(1024 * 1024):
                            total += len(block)
                            if total > 300_000_000:
                                raise ValueError('Modelo de voz excede o tamanho permitido.')
                            output.write(block)
                temporary.replace(target)
        return self.status()

    async def speak(self, text, on_amplitude=None):
        piper = self.piper_ready()
        if not piper and importlib.util.find_spec('pyttsx3') is None:
            raise ValueError('Síntese local indisponível. Instale as dependências opcionais de voz.')
        self.stop()
        model = str(self.tts_directory / 'pt_BR-faber-medium.onnx') if piper else None
        process, events = make_worker(speak_worker, (text[:10000], model), maxsize=128)
        self.speaker = process
        process.start()
        try:
            while process.is_alive():
                while not events.empty():
                    event = events.get_nowait()
                    if event.get('error'):
                        raise ValueError(event['error'])
                    if 'amplitude' in event and on_amplitude:
                        await on_amplitude(event['amplitude'])
                await asyncio.sleep(.03)
            while not events.empty():
                event = events.get_nowait()
                if event.get('error'):
                    raise ValueError(event['error'])
            if process.exitcode and self.speaker is process:
                raise ValueError('A voz do Windows não pôde ser reproduzida.')
        finally:
            if process.is_alive():
                process.terminate()
            await asyncio.to_thread(process.join, 3)
            events.close()
            if on_amplitude:
                await on_amplitude(0)
            if self.speaker is process:
                self.speaker = None

    def stop(self):
        for process in (self.speaker, self.transcriber, self.downloader):
            if process and process.is_alive():
                process.terminate()
        self.speaker = None

    async def wake_audio(self, audio, threshold=.65):
        if self.wake is None:
            raise ValueError('Prepare o modelo de wake word nas configurações antes de ativá-lo.')
        import numpy as np
        scores = await asyncio.to_thread(self.wake.predict, np.asarray(audio, dtype=np.int16))
        score = max((float(value) for value in scores.values()), default=0)
        self.last_wake_score = score
        self.wake_hits = self.wake_hits + 1 if score >= threshold else 0
        detected = self.wake_hits >= 2
        if detected:
            self.wake.reset()
            self.wake_hits = 0
        return detected

    def wake_ready(self):
        return all((self.wake_directory / name).exists() for name in ('melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'))

    async def prepare_wake(self, allow_download=True):
        if importlib.util.find_spec('openwakeword') is None:
            raise ValueError('Dependência opcional openWakeWord indisponível.')
        import openwakeword
        from openwakeword.model import Model
        urls = [entry['download_url'].replace('.tflite', '.onnx') for entry in openwakeword.FEATURE_MODELS.values()]
        urls.append(openwakeword.MODELS['hey_jarvis']['download_url'].replace('.tflite', '.onnx'))
        self.wake_directory.mkdir(parents=True, exist_ok=True)
        for url in urls:
            target = self.wake_directory / url.rsplit('/', 1)[-1]
            if not target.exists():
                if not allow_download:
                    raise ValueError('Prepare os modelos de wake word antes de ativar o modo somente local.')
                async with httpx.AsyncClient(timeout=90, follow_redirects=True, trust_env=False) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    temporary = target.with_suffix('.tmp')
                    temporary.write_bytes(response.content)
                    temporary.replace(target)
        self.wake = await asyncio.to_thread(Model, wakeword_models=[str(self.wake_directory / 'hey_jarvis_v0.1.onnx')],
                         inference_framework='onnx', melspec_model_path=str(self.wake_directory / 'melspectrogram.onnx'),
                         embedding_model_path=str(self.wake_directory / 'embedding_model.onnx'), ncpu=1)
