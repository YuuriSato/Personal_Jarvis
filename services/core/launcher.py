"""Parent sends bootstrap/secrets through stdin, never process arguments or environment."""
import json
import multiprocessing
import os
import socket
import sys
import threading
import uvicorn
from services.core.orchestration import Core
from services.core.api import create_app


def main():
    config = json.loads(sys.stdin.readline())
    core = Core(config['directory'])
    core.providers.secrets.update(config.get('keys', {}))
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind(('127.0.0.1', 0))
    port = server_socket.getsockname()[1]
    app = create_app(core, config['token'])
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error', access_log=False, ws='wsproto'))

    def control():
        for line in sys.stdin:
            try:
                message = json.loads(line)
                if message.get('type') == 'key' and message.get('provider') in core.providers.configs:
                    if message.get('key'):
                        core.providers.secrets[message['provider']] = message['key']
                    else:
                        core.providers.secrets.pop(message['provider'], None)
                    print(json.dumps({'key_ack': message.get('id')}), flush=True)
                elif message.get('type') == 'stop':
                    server.should_exit = True
            except (ValueError, KeyError):
                continue
        server.should_exit = True  # Parent died: do not leave an orphan service.

    threading.Thread(target=control, daemon=True).start()
    print(json.dumps({'ready': True, 'port': port}), flush=True)
    server.run(sockets=[server_socket])


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
