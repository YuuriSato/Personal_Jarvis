# Arquitetura e decisões

Renderer React → preload restrito → Electron principal → Core FastAPI → adaptadores/ferramentas.

O renderer não conhece token do Core nem segredos armazenados. O Electron transmite bootstrap e credenciais por stdin do processo filho; autentica HTTP/WebSockets com token de sessão. O Core aceita somente loopback e rejeita Origin de navegador. O frontend nunca interpreta texto do modelo como HTML executável.

## Contratos

`contracts/index.ts` descreve o bridge e os eventos v1. `services/core/contracts.py` valida ações, limites e configurações. A ponte aceita uma lista fechada de operações, e pastas/aplicativos novos só podem vir do seletor nativo. O processo principal confere remetente e frame.

Reconexões recebem novo snapshot. Eventos são deduplicados por sessão/sequência. Consumidor lento de WebSocket é desconectado para recuperar o estado; aprovações não são descartadas silenciosamente. Não há repetição automática de ferramentas ou fallback de modelo no modo manual.

## Segurança de ferramentas

Cada proposta tem id aleatório, parâmetros copiados, validade e impressão de permissões/estado do arquivo. A aprovação é consumida uma vez. Caminhos absolutos são resolvidos, precisam pertencer a uma pasta concedida, e links/junções e arquivos sensíveis conhecidos são bloqueados. Arquivos e permissões são revalidados imediatamente antes da execução. Arquivos novos usam criação exclusiva e movimentações nunca sobrescrevem destinos existentes.

O controle protege contra chamadas indevidas dentro do aplicativo. Não oferece isolamento de processos locais maliciosos que já tenham permissões do usuário nem garantia absoluta contra alterações concorrentes do sistema de arquivos.

## Privacidade e memória

Chaves são criptografadas com safeStorage assíncrono; somente entrada transitória do formulário passa pelo renderer. SQLite usa WAL e escrita serializada. Eventos e exportações passam por remoção de credenciais conhecidas. Contexto de conversas antigas não é enviado automaticamente ao reiniciar; memórias consentidas são anexadas ao contexto do modelo ativo.

O modo local impede os três adaptadores remotos, serviços de clima e downloads de voz. Ollama é consultado para rejeitar modelos que roteiam para nuvem. Ferramentas aprovadas não podem trocar provedores, conceder pastas ou alterar configurações.

## Orquestração e custos

Manual usa o provedor fixado. Automático usa candidatos habilitados com modelo selecionado, prioriza local e depois preço configurado. Colaborativo limita três participantes e duas rodadas; participantes não recebem ferramentas. A rota é determinística e exibida no terminal; não promete escolher universalmente o melhor modelo.

O orçamento é uma barreira estimada, por dia UTC, baseada em preços informados e no limite de saída. Chamadas interrompidas sem uso reportado ficam desconhecidas; não são contadas como gratuitas. Não é um limite de cobrança garantido pelo provedor.

## Voz e visual

Áudio mono PCM 16 kHz é mantido em memória. Transcrição e TTS rodam em processos canceláveis. Wake word é explicitamente reativada a cada abertura. O rosto é geometria procedural original, em vez de um ativo 3D externo. Expressividade é independente do estado operacional, nunca uma alegação de sentimentos reais.
