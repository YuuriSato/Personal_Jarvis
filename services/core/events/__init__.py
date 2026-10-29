import asyncio
from uuid import uuid4
from ..persistence import now


class EventBus:
    def __init__(self, session_id, redact=lambda value: value):
        self.session_id = session_id
        self.sequence = 0
        self.clients: set[asyncio.Queue] = set()
        self.redact = redact

    async def emit(self, kind, payload=None, run_id=None, source='core'):
        self.sequence += 1
        event = dict(version=1, event_id=str(uuid4()), sequence=self.sequence,
                     timestamp=now(), session_id=self.session_id, run_id=run_id,
                     type=kind, source=source, payload=self.redact(payload or {}))
        for queue in tuple(self.clients):
            if queue.full():
                # Disconnect a slow client rather than silently lose an approval/result.
                self.clients.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)
            else:
                queue.put_nowait(event)
        return event
