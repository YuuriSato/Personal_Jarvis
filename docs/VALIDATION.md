# Validação — JARVIS 0.2.0

Verificações realizadas em 29 de outubro de 2026, no Windows deste ambiente. Testes automatizados usam dados temporários; gravações do usuário e credenciais não fazem parte das evidências.

## Integrações reais

- LM Studio: Qwen3.5 4B com conversa, respostas incrementais, cancelamento e chamada real da ferramenta de hardware. Catálogo nativo distingue modelos baixados e carregados; descoberta não carrega nem baixa pesos.
- Colaboração: dois papéis explícitos no mesmo Qwen, seguidos de síntese. Foram três chamadas reais; não houve comparação entre modelos distintos.
- Memória semântica: Nomic Embed Text v1.5 no LM Studio, indexação e recuperação reais de memórias temporárias. Prefixos específicos de documento e consulta; índice versionado para reindexação.
- Clima: consulta real da Open-Meteo para a cidade configurada pelo usuário, condição traduzida, fonte e horário. Consulta depende de rede e é bloqueada no modo somente local.
- Transcrição: faster-whisper base local, português, CPU. Reconhecimento de fala sintética limpa e com ruído de 15 dB; houve pequena imprecisão no áudio limpo. Isso não mede a qualidade para todas as vozes ou ambientes.
- TTS: voz Piper Faber pt_BR preparada no aplicativo, síntese e reprodução local reais, eventos de amplitude do PCM e interrupção em aproximadamente 33 ms na execução observada. Não foi instalado um pacote de idioma global no Windows.
- Wake word: modelos locais preparados; duas detecções nas duas repetições sintéticas de “Hey Jarvis”. Nenhuma ativação em cinco segundos de ruído branco. Esse ensaio curto não estabelece taxa de falsos positivos em uso diário.
- Nenhum áudio foi capturado do usuário. A sessão atual expõe saída de áudio remoto e nenhum dispositivo de entrada.

## Verificações automatizadas

- Compilação TypeScript/Electron e produção Vite.
- 61 testes Python: contratos, permissões, persistência, privacidade, cancelamento, provedores, ferramentas, clima, papéis colaborativos, falhas de voz e debounce da wake word.
- Playwright: HUD em 1920×1080, 1366×768 e 1536×864; configurações, Electron/Core, fluxo LM Studio controlado, animação ligada ao estado real, movimento reduzido e ausência de microfone.
- Telemetria real CPU/RAM/disco/NVIDIA. Temperatura da CPU indisponível no mecanismo atual do Windows, identificada na interface.
- Cofre safeStorage com credencial fictícia, removida após teste; rejeição de permissões genéricas, concessão por seletor nativo e aprovações exatas de uso único para arquivos temporários.
- Redação de credenciais em eventos/exportações, inclusive fragmentos. Modo somente local bloqueia IA remota, clima e downloads; alterações de configuração cancelam operações pendentes.
- Dependências locais de voz compatíveis com Python 3.13 neste ambiente.
- Workers do executável usam um protocolo restrito por pipes; texto e áudio não entram nos argumentos de processos nem em arquivos temporários. A inicialização de workers ocorre antes da inicialização do servidor.
- Core congelado com PATH restrito ao System32: transcrição do WAV sintético em português, reprodução real Piper, interrupção em aproximadamente 31 ms e duas detecções sintéticas de Hey Jarvis. O detector é importado antes da thread de controle para evitar o travamento de inicialização BLAS/CRT observado no Windows.
- Núcleo visual mantém o rosto em partículas e usa arcos em contrarrotação, varredura luminosa e pulsação durante solicitações ativas. A expressão continua sendo uma simulação visual.

## Limites e pendências de validação

- Microfone físico, voz do usuário, eco da própria resposta e qualidade em ruído real precisam de teste com um dispositivo de entrada disponível. A wake word fica desabilitada até ativação explícita.
- OpenAI, Gemini e Claude não foram chamados: o usuário escolheu validar somente IAs locais. Ollama mantém testes de contrato; a inferência real desta rodada usou LM Studio.
- Colaboração entre modelos distintos não foi testada nesta rodada.
- Os ensaios sintéticos não substituem avaliação auditiva humana de pronúncia e compreensão.
- Meta de 60 FPS/mínimo de 30 FPS durante inferência real ainda requer medição em sessão visível. O núcleo oferece adaptação de qualidade e movimento reduzido.
- O teste do aplicativo empacotado restringe o PATH ao Windows; não substitui uma instalação em máquina limpa. O instalador pessoal não tem assinatura comercial.
- MCP é uma extensão opcional, sem servidores conectados.

## Reproduzir

    npm run build
    npm run test:core
    npm test
    npm run package:win
    node scripts/smoke-core.mjs
    npm run test:packaged

Para repetir o teste de voz do executável, forneça um diretório com modelos preparados e dois WAV PCM16 sintéticos (fala em português sobre computador/memória e “Hey Jarvis”):

    node scripts/smoke-voice.mjs CAMINHO_DOS_MODELOS fala-pt.wav hey-jarvis.wav

O teste usa um perfil temporário próprio, sem capturar microfone, baixar modelos ou enviar áudio à nuvem. O script não prepara os WAVs nem pressupõe credenciais.

Modelos e dados pessoais ficam fora do repositório. Downloads de voz e carregamento de modelos exigem ação explícita. Testes reais com modelos disponíveis são separados dos testes de contrato e não consomem APIs pagas.
