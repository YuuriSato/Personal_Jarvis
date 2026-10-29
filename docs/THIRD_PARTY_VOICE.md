# Componentes de voz local

O aplicativo pessoal usa os componentes abaixo. Os modelos são preparados por ação explícita e ficam nos dados do usuário, separados do código.

| Componente | Origem | Licença indicada pelo projeto |
|---|---|---|
| Piper TTS 1.8.0 | https://github.com/OHF-Voice/piper1-gpl | GPL-3.0-or-later |
| Voz Faber pt_BR medium | https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR/faber/medium | Dataset CC0, conforme MODEL_CARD do modelo |
| faster-whisper | https://github.com/SYSTRAN/faster-whisper | MIT |
| openWakeWord | https://github.com/dscripka/openWakeWord | Código Apache-2.0; modelos pré-treinados sujeitos às licenças próprias, incluindo uso não comercial |
| sounddevice / PortAudio | https://github.com/spatialaudio/python-sounddevice | Licenças do pacote e da biblioteca PortAudio |

O MODEL_CARD da voz é preservado junto aos pesos. Metadados e licença do Piper são incluídos no serviço empacotado; o código-fonte e as instruções de compilação estão disponíveis na origem acima. Esta entrega tem finalidade de uso pessoal. A fala funciona em processo separado e não transmite texto ou áudio para um serviço de TTS.
