import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, JarvisEvent, RunState, Snapshot } from '../../../../contracts';

export interface Log { id: string; timestamp: string; role: string; content: string; provider?: string; model?: string; }
function transmissionText(message: any): string {
  if (message.provider !== 'system') return message.content;
  try {
    const value = JSON.parse(message.content);
    if (message.model === 'hardware') return `Diagnóstico concluído. CPU ${value.cpu_percent == null ? 'indisponível' : value.cpu_percent + '%'} · RAM ${value.ram_percent}%.`;
    if (value.created) return `Arquivo criado e verificado: ${value.created}`;
    if (value.moved) return `Arquivo movido e verificado: ${value.destination}`;
    if (value.launched) return `Processo iniciado: ${value.launched} · PID ${value.pid}.`;
    if (value.path) return `Arquivo lido: ${value.path}`;
  } catch { /* Plain text remains unchanged. */ }
  return message.content;
}
export function useJarvis() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RunState>('disconnected');
  const [logs, setLogs] = useState<Log[]>([]);
  const [stream, setStream] = useState('');
  const [transmission, setTransmission] = useState('Aguardando conexão com o JARVIS Core.');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [playbackAmplitude, setPlaybackAmplitude] = useState(0);
  const sequence = useRef(new Map<string, number>());
  const refresh = useCallback(async () => {
    if (!window.jarvis) return;
    try {
      const data: Snapshot = await window.jarvis.action({ type: 'snapshot' });
      setSnapshot(data); setConnected(true);
      setLogs(previous => {
        const existing = previous.filter(log => log.role === 'system' || log.role === 'error' || log.role === 'tool');
        return [...data.messages, ...existing].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-150);
      });
      const active = data.runs.find(run => ['processing', 'awaiting_approval', 'executing'].includes(run.state));
      if (active) { setState(active.state); setBusy(true); }
      else { setState(previous => previous === 'disconnected' ? 'idle' : previous); setBusy(false); }
    } catch { setConnected(false); setState('disconnected'); }
  }, []);
  const action = useCallback(async (value: Action) => {
    if (!window.jarvis) { setNotice('Esta é uma prévia da interface. Abra o aplicativo desktop para usar o Core.'); return; }
    try {
      const result = await window.jarvis.action(value);
      if (['settings', 'provider', 'memory', 'memory_delete', 'history_clear', 'models', 'lmstudio_load', 'voice_prepare', 'voice_prepare_tts', 'voice_prepare_wake', 'weather_refresh', 'approve'].includes(value.type)) await refresh();
      return result;
    } catch (error) { setNotice((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
  }, [refresh]);
  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (window.jarvis) refresh(); }, 10000);
    if (!window.jarvis) return () => clearInterval(timer);
    const unsubscribe = window.jarvis.onEvent((event: JarvisEvent) => {
      const previous = sequence.current.get(event.session_id) ?? -1;
      if (event.sequence <= previous) return;
      sequence.current.set(event.session_id, event.sequence);
      const payload = event.payload;
      const append = (role: string, content: string) => setLogs(logs => [...logs, { id: event.event_id, timestamp: event.timestamp, role, content }].slice(-150));
      switch (event.type) {
        case 'core.connected': setConnected(true); setState('idle'); setTransmission('Core conectado. Selecione um modelo para começar.'); refresh(); break;
        case 'core.disconnected': setConnected(false); setState('disconnected'); setBusy(false); setTransmission(payload.message); break;
        case 'state.changed': refresh(); break;
        case 'telemetry.updated': setSnapshot(data => data ? { ...data, telemetry: payload as any } : data); break;
        case 'weather.updated': setSnapshot(data => data ? { ...data, weather: payload as any } : data); break;
        case 'usage.updated': setSnapshot(data => data ? { ...data, usage: payload as any } : data); break;
        case 'run.started': setBusy(true); setState('processing'); setStream(''); setTransmission('Processando solicitação…'); break;
        case 'run.stage_changed': setState(payload.state); break;
        case 'run.collaborator': append('system', `Colaboração: ${payload.provider}${payload.model ? ' / ' + payload.model : ''} · ${payload.role || 'analista'}${payload.distinct_models === 1 ? ' (papéis no mesmo modelo local)' : ''}.`); break;
        case 'memory.search_failed': append('system', payload.message); break;
        case 'message.delta': setStream(payload.content); setTransmission(payload.content); break;
        case 'message.completed':
          setLogs(logs => logs.some(log => log.id === payload.id) ? logs : [...logs, payload as Log].slice(-150));
          if (payload.role === 'assistant') { setTransmission(transmissionText(payload)); setStream(''); }
          break;
        case 'run.completed': setState('completed'); setBusy(false); setStream(''); refresh(); break;
        case 'run.cancelled': setState('idle'); setBusy(false); setStream(''); setTransmission('Execução interrompida.'); refresh(); break;
        case 'run.failed': setState('error'); setBusy(false); setStream(''); setTransmission(payload.error); append('error', payload.error); refresh(); break;
        case 'approval.required': setState('awaiting_approval'); setTransmission('Uma ação precisa da sua aprovação.'); refresh(); break;
        case 'approval.resolved': refresh(); break;
        case 'tool.started': append('tool', `Iniciando ${payload.tool}.`); break;
        case 'tool.completed': append('tool', `${payload.tool} concluído e verificado.`); refresh(); break;
        case 'tool.failed': append('error', payload.error); refresh(); break;
        case 'voice.state_changed': setState(payload.state); if (payload.state === 'idle') setPlaybackAmplitude(0); break;
        case 'voice.amplitude': setPlaybackAmplitude(payload.value); break;
        case 'voice.failed': setNotice(payload.message); setPlaybackAmplitude(0); break;
      }
    });
    return () => { clearInterval(timer); unsubscribe(); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(timer); }, [notice]);
  return { snapshot, connected, state, setState, logs, stream, transmission, notice, setNotice, busy, action, refresh, playbackAmplitude };
}
