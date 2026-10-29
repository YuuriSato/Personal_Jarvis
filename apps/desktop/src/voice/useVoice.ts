import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '../../../../contracts';

export function useVoice(action: (a: Action) => Promise<any>, enabled: boolean, wakeWord: boolean, setNotice: (v: string) => void, suspended = false) {
  const [recording, setRecording] = useState(false);
  const [armed, setArmed] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const session = useRef<{ stream: MediaStream; context: AudioContext; processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode; audio: number[]; wakeBuffer: number[]; capturing: boolean; started: number; sending: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const actionRef = useRef(action);
  const starting = useRef(false);
  const epoch = useRef(0);
  const paused = useRef(false);
  actionRef.current = action;
  const cleanup = useCallback(() => {
    epoch.current++;
    const current = session.current;
    if (!current) return;
    current.processor.disconnect(); current.source.disconnect();
    current.stream.getTracks().forEach(track => track.stop());
    current.context.close(); clearTimeout(current.timer); session.current = null;
    setRecording(false); setArmed(false); setAmplitude(0);
  }, []);
  const stop = useCallback(async () => {
    const current = session.current;
    const audio = current?.audio || [];
    cleanup();
    if (audio.length > 4000) {
      const result = await actionRef.current({ type: 'voice_transcribe', audio, sample_rate: 16000 });
      if (result?.text) await actionRef.current({ type: 'message', text: result.text });
    }
  }, [cleanup]);
  const start = useCallback(async (wake = false) => {
    if (!enabled) { setNotice('Habilite e prepare a voz local nas configurações.'); return; }
    if (suspended) { setNotice('Aguarde ou interrompa a atividade atual antes de gravar.'); return; }
    if (starting.current) return;
    paused.current = false;
    if (session.current) { await stop(); return; }
    starting.current = true;
    const generation = ++epoch.current;
    try {
      await actionRef.current({ type: 'voice_stop' });
      if (generation !== epoch.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation !== epoch.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const context = new AudioContext({ sampleRate: 16000 });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const current = { stream, context, processor, source, audio: [] as number[], wakeBuffer: [] as number[], capturing: !wake, started: Date.now(), sending: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      session.current = current;
      processor.onaudioprocess = event => {
        const data = event.inputBuffer.getChannelData(0);
        const pcm = Array.from(data, v => Math.round(Math.max(-1, Math.min(1, v)) * 32767));
        const rms = Math.sqrt(data.reduce((sum, v) => sum + v*v, 0) / data.length);
        setAmplitude(Math.min(1, rms * 8));
        if (current.capturing) {
          current.audio.push(...pcm);
          if (current.audio.length >= 16000 * 30) void stop();
        } else {
          current.wakeBuffer.push(...pcm);
          if (current.wakeBuffer.length >= 1280 && !current.sending) {
            current.sending = true;
            void (async () => {
              try {
                while (session.current === current && !current.capturing && current.wakeBuffer.length >= 1280) {
                  const frame = current.wakeBuffer.splice(0, 1280);
                  const result = await actionRef.current({ type: 'wake_audio', audio: frame });
                  if (!result) { cleanup(); break; }
                  if (result.detected && session.current === current) {
                    current.capturing = true; current.audio = []; setRecording(true);
                    current.timer = setTimeout(() => void stop(), 8000);
                  }
                }
              } finally { current.sending = false; }
            })();
          }
          if (current.wakeBuffer.length > 16000) current.wakeBuffer.splice(0, current.wakeBuffer.length - 1280);
        }
      };
      source.connect(processor); processor.connect(context.destination);
      await context.resume(); setRecording(!wake); setArmed(wake);
    } catch (error) { cleanup(); setNotice((error as DOMException).name === 'NotFoundError' ? 'Nenhum microfone está disponível nesta sessão do Windows.' : 'Não foi possível acessar o microfone. Verifique o dispositivo e sua permissão no Windows.'); }
    finally { starting.current = false; }
  }, [enabled, suspended, setNotice, stop, cleanup]);
  useEffect(() => { paused.current = false; }, [wakeWord]);
  useEffect(() => {
    if (enabled && wakeWord && !suspended && !paused.current) void start(true);
    return cleanup;
  }, [enabled, wakeWord, suspended, cleanup, start]);
  useEffect(() => { if (!enabled) cleanup(); }, [enabled, cleanup]);
  const pause = useCallback(() => { paused.current = true; cleanup(); }, [cleanup]);
  return { recording, armed, amplitude, start, stop, cleanup, pause };
}
