# Integração LM Studio

O JARVIS usa o servidor HTTP local do LM Studio. O endereço inicial é `http://127.0.0.1:1234/v1`. Outros endereços de loopback podem ser configurados; não há varredura da rede.

## Usar pela interface

1. Inicie o servidor local no LM Studio.
2. No JARVIS, abra CONFIG → Inteligências → LM Studio.
3. Clique em Consultar modelos. O catálogo distingue modelos de conversa, embeddings, capacidades informadas e instâncias carregadas.
4. Selecione um modelo de conversa já baixado. Modelos de embeddings não aparecem como opções de conversa.
5. Se estiver descarregado, clique em Carregar modelo selecionado. A operação usa a API nativa, contexto de 4096 tokens e não baixa pesos nem solicita descarregamento de outros modelos.
6. Clique em Usar LM Studio e envie um comando.

Sem um modelo carregado, a conversa retorna uma orientação explícita em vez de provocar carregamento automático. Modelos sem suporte confirmado a ferramentas recebem apenas conversa; modelos com suporte informado podem propor ferramentas sujeitas à mesma validação e aprovação do Core.

Se o servidor exigir autenticação, cadastre seu token na entrada de API key do LM Studio. O token fica no cofre do sistema e só é enviado ao endereço local configurado.

## Compatibilidade

Descoberta usa `GET /api/v1/models`, com fallback para `/api/v0/models` e depois `/v1/models` apenas quando o endpoint não existe. Erros de autenticação ou de servidor não são contornados por fallback. Versões antigas sem metadados mantêm o estado como desconhecido e exigem carregamento pelo próprio LM Studio quando não há API nativa de carregamento.

Conversação usa `POST /v1/chat/completions`, streaming SSE, chamadas de ferramentas e contadores de tokens. O identificador da instância carregada é respeitado. Embeddings usam `/v1/embeddings`, com preparação explícita do modelo em Memória.

## Diagnóstico sem alterações

```powershell
node scripts/python.mjs scripts/probe-lmstudio.py
```

Esse diagnóstico apenas consulta os catálogos locais. Não carrega, baixa ou descarrega modelos.

Referências oficiais: [catálogo nativo](https://lmstudio.ai/docs/developer/rest/list), [carregamento](https://lmstudio.ai/docs/developer/rest/load) e [conversa compatível com OpenAI](https://lmstudio.ai/docs/developer/openai-compat/chat-completions).
