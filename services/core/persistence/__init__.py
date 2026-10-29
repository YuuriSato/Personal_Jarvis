import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    """A serialized SQLite writer; application data is never stored in the checkout."""
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(directory / 'jarvis.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT);
            CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, session_id TEXT, role TEXT,
                content TEXT, timestamp TEXT, provider TEXT, model TEXT, run_id TEXT);
            CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, content TEXT, source TEXT,
                created_at TEXT, expires_at TEXT);
            CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, timestamp TEXT, kind TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY, timestamp TEXT, provider TEXT,
                model TEXT, input_tokens INTEGER, output_tokens INTEGER, estimated_cost REAL);
            INSERT OR IGNORE INTO migrations VALUES(1, datetime('now'));
        ''')
        self.db.commit()

    def get(self, key, default=None):
        with self.lock:
            row = self.db.execute('SELECT value FROM config WHERE key=?', (key,)).fetchone()
            return json.loads(row['value']) if row else default

    def put(self, key, value):
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO config VALUES(?,?)', (key, json.dumps(value)))

    def message(self, session_id, role, content, provider='', model='', run_id=''):
        value = dict(id=str(uuid4()), session_id=session_id, role=role, content=content,
                     timestamp=now(), provider=provider, model=model, run_id=run_id)
        with self.lock, self.db:
            self.db.execute('INSERT INTO messages VALUES(:id,:session_id,:role,:content,:timestamp,:provider,:model,:run_id)', value)
        return value

    def messages(self, session_id=None, limit=150):
        with self.lock:
            if session_id:
                rows = self.db.execute('SELECT * FROM messages WHERE session_id=? ORDER BY rowid DESC LIMIT ?', (session_id, limit)).fetchall()
            else:
                rows = self.db.execute('SELECT * FROM messages ORDER BY rowid DESC LIMIT ?', (limit,)).fetchall()
            return [dict(r) for r in reversed(rows)]

    def audit(self, kind, data):
        with self.lock, self.db:
            self.db.execute('INSERT INTO audit VALUES(?,?,?,?)', (str(uuid4()), now(), kind, json.dumps(data, ensure_ascii=False)))

    def memories(self, query=''):
        with self.lock:
            rows = self.db.execute('SELECT * FROM memories WHERE (expires_at IS NULL OR julianday(expires_at)>julianday(?)) AND content LIKE ? ORDER BY created_at DESC LIMIT 100', (now(), f'%{query}%')).fetchall()
            return [dict(r) for r in rows]

    def remember(self, content, memory_id='', expires_at=None):
        if expires_at:
            expiry = datetime.fromisoformat(expires_at)
            if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
                raise ValueError('A expiração deve ser uma data futura com fuso horário.')
        key = memory_id or str(uuid4())
        with self.lock, self.db:
            self.db.execute('INSERT OR REPLACE INTO memories VALUES(?,?,?,?,?)', (key, content, 'user_consent', now(), expires_at))
        return key

    def forget(self, key):
        with self.lock, self.db:
            self.db.execute('DELETE FROM memories WHERE id=?', (key,))
            if self.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vectors'").fetchone():
                self.db.execute('DELETE FROM memory_vectors WHERE memory_id=?', (key,))

    def clear_history(self):
        with self.lock, self.db:
            self.db.execute('DELETE FROM messages')

    def add_usage(self, provider, model, input_tokens, output_tokens, estimated_cost):
        with self.lock, self.db:
            self.db.execute('INSERT INTO usage VALUES(?,?,?,?,?,?,?)', (str(uuid4()), now(), provider, model, input_tokens, output_tokens, estimated_cost))

    def usage(self):
        with self.lock:
            row = self.db.execute("SELECT coalesce(sum(input_tokens),0) input_tokens, coalesce(sum(output_tokens),0) output_tokens, coalesce(sum(estimated_cost),0) estimated_cost, sum(CASE WHEN estimated_cost IS NULL THEN 1 ELSE 0 END) unpriced FROM usage WHERE substr(timestamp,1,10)=?", (now()[:10],)).fetchone()
            return dict(row) | {'unpriced': row['unpriced'] or 0}

    def export(self):
        with self.lock:
            return {'version': 1, 'exported_at': now(), 'messages': self.messages(limit=100000),
                    'memories': self.memories(), 'audit': [dict(r) for r in self.db.execute('SELECT * FROM audit ORDER BY timestamp')], 'usage_today': self.usage()}

    def close(self):
        with self.lock:
            self.db.close()
