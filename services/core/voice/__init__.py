import asyncio
import importlib.util
import io
import json
import multiprocessing
from pathlib import Path
import wave
import httpx


def speak_worker(text):
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
        self.speaker = None
        self.transcriber = None
        self.downloader = None
        self.wake = None
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
                'tts_voices': self.tts_voices, 'tts_portuguese': any(v['portuguese'] for v in self.tts_voices),
                'reason': 'Pronto' if available and ready else 'Prepare o modelo local nas configurações de voz.'}

    async def prepare(self):
        if not self.status()['available']:
            raise ValueError('Instale as dependências opcionais de voz com npm run setup:voice.')
        context = multiprocessing.get_context('spawn')
        queue = context.Queue()
        process = context.Process(target=download_worker, args=(str(self.directory), queue), daemon=True)
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
        context = multiprocessing.get_context('spawn')
        queue = context.Queue()
        process = context.Process(target=transcribe_worker, args=(audio, str(self.directory), queue), daemon=True)
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

    async def speak(self, text):
        if importlib.util.find_spec('pyttsx3') is None:
            raise ValueError('Síntese local indisponível. Instale as dependências opcionais de voz.')
        self.stop()
        process = multiprocessing.get_context('spawn').Process(target=speak_worker, args=(text[:10000],), daemon=True)
        self.speaker = process
        process.start()
        try:
            while process.is_alive():
                await asyncio.sleep(.1)
            if process.exitcode and self.speaker is process:
                raise ValueError('A voz do Windows não pôde ser reproduzida.')
        finally:
            if self.speaker is process:
                self.speaker = None

    def stop(self):
        for process in (self.speaker, self.transcriber, self.downloader):
            if process and process.is_alive():
                process.terminate()
        self.speaker = None

    async def wake_audio(self, audio):
        if self.wake is None:
            raise ValueError('Prepare o modelo de wake word nas configurações antes de ativá-lo.')
        import numpy as np
        scores = await asyncio.to_thread(self.wake.predict, np.asarray(audio, dtype=np.int16))
        return any(float(value) > .7 for value in scores.values())

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
