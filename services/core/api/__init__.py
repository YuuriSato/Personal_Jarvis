import asyncio
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from ..contracts import Action


def create_app(core, token):
    @asynccontextmanager
    async def lifespan(app):
        await core.start()
        try:
            yield
        finally:
            await core.stop()

    app = FastAPI(title='JARVIS Core', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    def authenticated(value):
        return secrets.compare_digest(value or '', 'Bearer ' + token)

    @app.middleware('http')
    async def auth(request: Request, call_next):
        from starlette.responses import JSONResponse
        if request.headers.get('origin') or not authenticated(request.headers.get('authorization')):
            return JSONResponse({'error': 'Não autorizado.'}, status_code=401)
        if int(request.headers.get('content-length', '0')) > 8_000_000:
            return JSONResponse({'error': 'Pedido grande demais.'}, status_code=413)
        return await call_next(request)

    @app.get('/health')
    async def health():
        return {'ok': True, 'version': 1}

    @app.post('/action')
    async def action(value: Action):
        try:
            return await core.action(value)
        except asyncio.CancelledError:
            raise HTTPException(409, detail='Operação interrompida por cancelamento ou alteração de configuração.') from None
        except (ValueError, ValidationError) as exc:
            raise HTTPException(400, detail=core.redact(str(exc))) from None
        except Exception:
            raise HTTPException(503, detail='Operação indisponível. Verifique a configuração ou conectividade.') from None

    @app.websocket('/events')
    async def events(ws: WebSocket):
        if ws.headers.get('origin') or not authenticated(ws.headers.get('authorization')):
            await ws.close(code=1008)
            return
        await ws.accept()
        queue = asyncio.Queue(maxsize=500)
        core.bus.clients.add(queue)
        async def wait_disconnect():
            while True:
                message = await ws.receive()
                if message['type'] == 'websocket.disconnect':
                    return
        disconnected = asyncio.create_task(wait_disconnect())
        next_event = None
        try:
            await ws.send_json(await core.bus.emit('core.connected', {'session_id': core.session_id}))
            while True:
                next_event = asyncio.create_task(queue.get())
                completed, _ = await asyncio.wait([disconnected, next_event], timeout=15, return_when=asyncio.FIRST_COMPLETED)
                if disconnected in completed:
                    break
                if next_event in completed:
                    event = next_event.result()
                    if event is None:
                        await ws.close(code=1013)
                        return
                    await ws.send_json(event)
                else:
                    next_event.cancel()
                    await asyncio.gather(next_event, return_exceptions=True)
                    await ws.send_json({'type': 'heartbeat'})
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
        finally:
            core.bus.clients.discard(queue)
            disconnected.cancel()
            if next_event:
                next_event.cancel()
            await asyncio.gather(disconnected, *([next_event] if next_event else []), return_exceptions=True)
    return app
