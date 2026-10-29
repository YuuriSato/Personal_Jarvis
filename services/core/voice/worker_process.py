"""Explicit frozen-worker protocol: payloads travel through pipes, never argv/files."""
import json
import os
import queue
import subprocess
import sys
import threading


class ResultQueue(queue.Queue):
    def close(self):
        pass


class FrozenWorker:
    def __init__(self, name, arguments, results):
        self.name, self.arguments, self.results = name, arguments, results
        self.process = None
        self.reader = None

    def start(self):
        self.process = subprocess.Popen(
            [sys.executable, '--voice-worker'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
            creationflags=subprocess.CREATE_NO_WINDOW,
            env={**os.environ, 'PYINSTALLER_RESET_ENVIRONMENT': '1'})

        def send():
            try:
                self.process.stdin.write(json.dumps({'worker': self.name, 'arguments': self.arguments}))
                self.process.stdin.close()
            except (OSError, ValueError):
                pass

        def receive():
            try:
                for line in self.process.stdout:
                    try:
                        value = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(value, dict):
                        self.results.put(value)
            finally:
                self.process.stdout.close()

        self.reader = threading.Thread(target=receive, daemon=True)
        self.reader.start()
        threading.Thread(target=send, daemon=True).start()

    def is_alive(self):
        return self.process is not None and (self.process.poll() is None or self.reader.is_alive())

    @property
    def exitcode(self):
        return self.process.poll() if self.process else None

    def terminate(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()

    def join(self, timeout=None):
        if self.process:
            try:
                self.process.wait(timeout)
            except subprocess.TimeoutExpired:
                pass
            if self.reader:
                self.reader.join(timeout)


class PipeResults:
    def put(self, value):
        print(json.dumps(value, ensure_ascii=True), flush=True)

    put_nowait = put


def main():
    from . import download_worker, speak_worker, transcribe_worker
    workers = {'download_worker': download_worker, 'speak_worker': speak_worker, 'transcribe_worker': transcribe_worker}
    payload = json.loads(sys.stdin.read(8_000_001))
    worker = workers.get(payload.get('worker'))
    if worker is None:
        raise ValueError('Worker não permitido.')
    worker(*payload['arguments'], PipeResults())
