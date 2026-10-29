"""Optional semantic retrieval through an explicitly configured local embedding model."""
import hashlib
import json
import math
import httpx


class MemoryIndex:
    def __init__(self, core):
        self.core = core
        with core.store.lock, core.store.db:
            core.store.db.execute('CREATE TABLE IF NOT EXISTS memory_vectors(memory_id TEXT PRIMARY KEY, fingerprint TEXT, vector TEXT)')
            core.store.db.execute("INSERT OR IGNORE INTO migrations VALUES(2, datetime('now'))")

    def fingerprint(self, text):
        s = self.core.settings
        provider = self.core.providers.configs[s.embedding_provider]
        return hashlib.sha256(json.dumps(['embedding-v2', provider.base_url, s.embedding_provider, s.embedding_model, text]).encode()).hexdigest()

    async def embed(self, texts, purpose='document'):
        s = self.core.settings
        p = self.core.providers.gate(s.embedding_provider, True)
        if not s.embedding_model:
            raise ValueError('Configure um modelo local de embeddings.')
        await self.core.providers.ensure_local_model(p.id, s.embedding_model, True)
        if p.id == 'lmstudio':
            models = await self.core.providers.discover('lmstudio', True)
            selected = next((m for m in models if m['id'] == s.embedding_model), None)
            if selected and selected.get('state') == 'unloaded':
                raise ValueError('Carregue explicitamente o modelo de embeddings no LM Studio antes de indexar.')
            if selected and selected.get('kind') == 'llm':
                raise ValueError('Selecione um modelo de embeddings, não um modelo de conversa.')
        endpoint = '/embed' if p.id == 'ollama' else '/embeddings'
        if 'nomic' in s.embedding_model.lower():
            prefix = 'search_query: ' if purpose == 'query' else 'search_document: '
            texts = [prefix + text for text in texts]
        async with self.core.providers.client(p.id) as client:
            response = await client.post(p.base_url + endpoint, json={'model': s.embedding_model, 'input': texts})
            response.raise_for_status()
            result = response.json()
        vectors = result.get('embeddings') if p.id == 'ollama' else [row['embedding'] for row in sorted(result['data'], key=lambda row: row['index'])]
        if not vectors or len(vectors) != len(texts):
            raise ValueError('Resposta de embeddings inválida.')
        for vector in vectors:
            if not isinstance(vector, list) or not vector or len(vector) > 8192 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in vector):
                raise ValueError('Vetor de memória inválido.')
        return vectors

    async def index(self):
        memories = self.core.store.memories()
        if not memories:
            return {'indexed': 0}
        # The user explicitly requests indexing; no model is downloaded/loaded by this module.
        config = self.fingerprint('')
        vectors = await self.embed([m['content'] for m in memories])
        if config != self.fingerprint(''):
            raise ValueError('A configuração mudou durante a indexação. Tente novamente.')
        with self.core.store.lock, self.core.store.db:
            for memory, vector in zip(memories, vectors):
                self.core.store.db.execute('INSERT OR REPLACE INTO memory_vectors VALUES(?,?,?)',
                    (memory['id'], self.fingerprint(memory['content']), json.dumps(vector)))
        return {'indexed': len(memories)}

    async def search(self, query):
        memories = self.core.store.memories()
        if not self.core.settings.semantic_memory_enabled or not query or not memories:
            return memories[:20]
        candidates = []
        with self.core.store.lock:
            for memory in memories:
                row = self.core.store.db.execute('SELECT * FROM memory_vectors WHERE memory_id=? AND fingerprint=?',
                    (memory['id'], self.fingerprint(memory['content']))).fetchone()
                if row:
                    candidates.append((memory, json.loads(row['vector'])))
        if not candidates:
            return memories[:20]
        query_vector = (await self.embed([query], purpose='query'))[0]
        norm_query = math.sqrt(sum(v*v for v in query_vector)) or 1
        scored = []
        for memory, vector in candidates:
            if len(vector) != len(query_vector):
                continue
            norm = math.sqrt(sum(v*v for v in vector)) or 1
            score = sum(a*b for a, b in zip(vector, query_vector)) / (norm * norm_query)
            scored.append(memory | {'score': score})
        return sorted(scored, key=lambda m: m['score'], reverse=True)[:8]
