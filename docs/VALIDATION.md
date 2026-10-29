# Validação — 29 de outubro de 2026

## Verificado neste ambiente

- Compilação TypeScript do renderer e Electron, mais build de produção do Vite.
- 54 testes Python: persistência, migrações, expiração de memórias, contratos dos cinco provedores, ferramentas, autenticação, privacidade, orçamento, colaboração e cancelamento, mais catálogo nativo LM Studio, compatibilidade, carregamento explícito e capacidades reais.
- Testes Playwright: HUD em 1920×1080, 1366×768 e 1536×864 (área lógica equivalente a 125% de uma tela 1920×1080); controles de configuração/logs; integração Electron/Core; fluxo LM Studio com servidor local controlado.
- Telemetria real de CPU, RAM, disco e NVIDIA NVML. Temperatura da CPU indisponível pelo mecanismo atual do Windows, corretamente identificada na UI.
- Credencial fictícia criptografada pelo safeStorage do Windows, removida depois do teste, ausente de snapshots e do arquivo de cofre em texto aberto.
- Core empacotado com Python, respondendo sem autenticação somente com erro 401 e entregando telemetria ao cliente autenticado.
- Aplicativo empacotado testado com PATH restrito ao System32: carregamento pelo protocolo próprio, Core incluído, telemetria, cofre e controle de ferramentas.
- Concessão de pasta por seletor nativo (dialog substituído apenas no teste), criação exclusiva de arquivo temporário após aprovação e rejeição de reutilização da aprovação.
- Remoção de credenciais dos eventos e exportações, inclusive em respostas transmitidas em fragmentos.
- Modo local bloqueando provedores remotos e clima sem emitir pedidos para eles; mudança de configuração interrompendo descoberta, geração e preparação de voz pendentes.
- Ollama em nuvem bloqueado inclusive quando acessado por loopback. O adaptador Ollama é exclusivamente local nesta versão.
- Dependências de voz importadas com sucesso em Python 3.13, sem necessidade de instalar outro Python.
- Conexão real com o LM Studio local em loopback: os endpoints OpenAI, REST v1 e REST v0 responderam; o catálogo informou três modelos de conversa, um de embeddings e nenhuma instância carregada na descoberta. A descoberta não iniciou carregamento ou download.
- `npm audit --omit=dev`: nenhuma vulnerabilidade reportada nas dependências de execução no momento da verificação.

Os testes de provedores usam respostas controladas, incluindo ferramentas e contadores de uso. Isso verifica o formato dos adaptadores; não substitui testes reais com cada conta/modelo.

## Não validado ou dependente do usuário

- Nenhuma API paga foi chamada e nenhuma credencial real foi solicitada. OpenAI, Gemini e Claude precisam ser configurados e testados na conta do usuário.
- Nenhum modelo local foi carregado ou baixado automaticamente. A inferência real em LM Studio/Ollama depende do servidor e modelo selecionados.
- Modelo de transcrição e modelos de wake word não foram baixados durante a implementação. Use os controles explícitos na configuração de voz.
- Não houve gravação de microfone, teste de reconhecimento de fala real, avaliação auditiva de TTS ou aferição de falsos positivos da wake word.
- O Windows examinado oferece apenas Microsoft Hazel e Microsoft Zira, ambas em inglês. A interface alerta sobre a ausência de voz SAPI em português; a pronúncia em português depende de uma voz adequada instalada pelo usuário.
- O clima requer cidade/coordenadas configuradas e autorização de rede. Não houve consulta climática real durante os testes.
- Busca semântica foi testada com embeddings controlados locais. Seu uso real exige um modelo de embeddings já disponível no servidor escolhido.
- Meta de 60 FPS e mínimo de 30 FPS durante inferência local ainda precisa de medição em uma sessão visível com o modelo real. A implementação reduz partículas quando detecta renderização lenta.
- A versão empacotada foi testada no Windows atual com PATH restrito, não em uma VM limpa ou outro computador.
- O instalador pessoal não tem assinatura comercial. Nenhum serviço de hospedagem, atualização automática ou distribuição pública foi configurado.
- MCP permanece uma extensão opcional de arquitetura, sem servidores conectados nesta entrega.

## Reproduzir

```powershell
npm run build
npm run test:core
npm test
npm run package:win
node scripts/smoke-core.mjs
npm run test:packaged
```

Testes de ferramentas usam apenas arquivos temporários próprios. Testes Electron usam diretórios de dados separados dos dados reais. Evidências visuais ficam em `work/` e o instalador em `release/`.
