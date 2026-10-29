import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, ArrowUpRight, AudioLines, Check, ChevronRight, Clock3, Cpu, Eye, EyeOff, HardDrive, Keyboard, Mic, MicOff, Radio, Send, Settings2, ShieldCheck, Square, Terminal, Volume2, X, Zap } from 'lucide-react';
import ParticleCore from '../core-visual/ParticleCore';
import Settings from '../settings/Settings';
import Approvals from '../approvals/Approvals';
import { useJarvis } from '../state/useJarvis';
import { useVoice } from '../voice/useVoice';
import type { RunState } from '../../../../contracts';

const labels: Record<RunState, string> = { idle: 'EM ESPERA', disconnected: 'CORE DESCONECTADO', listening: 'OUVINDO', transcribing: 'TRANSCREVENDO', processing: 'PROCESSANDO', awaiting_approval: 'AGUARDANDO APROVAÇÃO', executing: 'EXECUTANDO', speaking: 'FALANDO', completed: 'CONCLUÍDO', error: 'ATENÇÃO NECESSÁRIA' };
function PanelTitle({ title, badge }: { title: string; badge: string }) { return <div className="panel-heading"><span><i className="status-dot" />{title}</span><small>{badge}</small></div>; }
const percent = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;
const gib = (value: number | undefined) => value === undefined ? '—' : (value / 1024**3).toFixed(1);

export default function App() {
  const jarvis = useJarvis();
  const { snapshot, connected, state, logs, stream, transmission, notice, setNotice, busy, action, refresh } = jarvis;
  const [now, setNow] = useState(new Date());
  const [command, setCommand] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const terminal = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const voice = useVoice(action, !!snapshot?.settings.voice_enabled, !!snapshot?.settings.wake_word, setNotice, busy || state === 'speaking' || state === 'transcribing');
  const displayState = voice.recording ? 'listening' : state;
  const telemetry = snapshot?.telemetry;
  const stale = !connected || !telemetry || now.getTime() - new Date(telemetry.timestamp).getTime() > 5000;
  const provider = snapshot?.providers.find(p => p.id === snapshot.settings.provider);
  const activeRun = [...(snapshot?.runs || [])].reverse().find(r => ['processing', 'executing', 'awaiting_approval'].includes(r.state));
  const activeProvider = snapshot?.providers.find(p => p.id === activeRun?.provider) || provider;
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (stick.current && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight; }, [logs, stream]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { voice.pause(); void action({ type: 'cancel' }); setSettingsOpen(false); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [action, voice.pause]);
  const submit = async () => {
    const text = command.trim();
    if (!text || busy) return;
    setCommand('');
    if (text === '/hardware' || text === '/diagnostico') await action({ type: 'tool', tool: 'hardware', args: {} });
    else if (text.startsWith('/abrir ')) await action({ type: 'tool', tool: 'open_app', args: { name: text.slice(7).trim() } });
    else if (text.startsWith('/ler ')) await action({ type: 'tool', tool: 'read_file', args: { path: text.slice(5).trim() } });
    else if (text.startsWith('/lembrar ')) await action({ type: 'memory', content: text.slice(9).trim() });
    else await action({ type: 'message', text });
  };
  const stop = () => { voice.pause(); void action({ type: 'cancel' }); };
  return <div className={`jarvis-app state-${displayState} ${snapshot?.settings.reduced_motion ? 'reduce-motion' : ''}`}>
    <div className="ambient-grid" aria-hidden="true" /><div className="scanlines" aria-hidden="true" />
    <header className="topbar">
      <div className="identity"><div className="identity-dot"><i /></div><div><strong>MARK-LXXXV <span>//</span> JARVIS</strong><small><i className={`status-dot ${connected ? '' : 'muted'}`} />{connected ? 'CORE_ONLINE' : 'CORE_OFFLINE'} <span>//</span> {voice.recording ? 'MIC_ACTIVE' : voice.armed ? 'WAKE_WORD_ACTIVE' : 'VOICE_STANDBY'}</small></div></div>
      <div className="top-center"><span className="version-tag">PERSONAL INTELLIGENCE SYSTEM</span><span className="top-separator" /><span className="privacy-indicator"><ShieldCheck size={11} />{snapshot?.settings.local_only ? 'LOCAL ONLY' : 'HYBRID / CONTROLLED'}</span></div>
      <div className="top-actions"><button className="top-button settings-button" aria-label="Abrir configurações" onClick={() => setSettingsOpen(true)}><Settings2 size={14} /><span>CONFIG</span></button><button className="top-button" onClick={() => setLogsOpen(v => !v)}>{logsOpen ? <EyeOff size={13} /> : <Eye size={13} />}<span>{logsOpen ? 'HIDE LOGS' : 'SHOW LOGS'}</span></button><button className="top-button terminate" onClick={stop}><span>TERMINATE</span><X size={14} /></button></div>
    </header>

    <aside className={`left-panels ${telemetryOpen ? 'mobile-open' : ''}`} aria-label="Telemetria do sistema">
      <section className="hud-panel temporal-panel"><PanelTitle title="JARVIS // TEMPORAL_SYNC" badge="CHRONO_LOCK" /><div className="time-card"><div><span className="micro-label">SYSTEM TIMESTAMP</span><time className="clock">{now.toLocaleTimeString('pt-BR', { hour12: false })}<span className="blink">_</span></time><small>{now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</small></div><div className="clock-dial"><Clock3 size={22} /></div></div><div className="panel-footnote">{Intl.DateTimeFormat().resolvedOptions().timeZone.toUpperCase()}<span>LOCAL CLOCK</span></div></section>
      <section className={`hud-panel hardware-panel ${stale ? 'stale' : ''}`}><PanelTitle title="SYS_HARDWARE" badge={stale ? 'NO SIGNAL' : 'LIVE TELEMETRY'} />
        <div className="metric-card"><div className="metric-title"><span><Cpu size={12} />CPU LOAD <small>({telemetry?.cpu_threads ?? '—'} THREADS)</small></span><strong>{percent(telemetry?.cpu_percent)}</strong></div><div className="metric-track"><i style={{ width: `${telemetry?.cpu_percent ?? 0}%` }} /></div><div className="metric-meta"><span>CORE TEMP</span><b>{telemetry?.cpu_temperature == null ? 'INDISPONÍVEL' : `${telemetry.cpu_temperature.toFixed(0)}°C`}</b></div></div>
        <div className="metric-card"><div className="metric-title"><span>RAM <small>({gib(telemetry?.ram_total)} GB)</small></span><strong>{percent(telemetry?.ram_percent)}</strong></div><div className="metric-track"><i style={{ width: `${telemetry?.ram_percent ?? 0}%` }} /></div><div className="metric-meta"><span>IN USE</span><b>{gib(telemetry?.ram_used)} GB</b></div></div>
        <div className="metric-card"><div className="metric-title"><span>GPU LOAD</span><strong>{percent(telemetry?.gpu_percent)}</strong></div><div className="metric-track"><i style={{ width: `${telemetry?.gpu_percent ?? 0}%` }} /></div><div className="metric-meta"><span className="gpu-name">{telemetry?.gpu_name || 'SENSOR INDISPONÍVEL'}</span><b>{telemetry?.gpu_temperature == null ? '—' : `${telemetry.gpu_temperature}°C`}</b></div></div>
        <div className="disk-line"><HardDrive size={11} /><span>STORAGE FREE</span><b>{gib(telemetry?.disk_free)} GB</b></div><div className="panel-footnote">{stale ? 'DADOS INDISPONÍVEIS / DESATUALIZADOS' : 'SOURCE: PSUTIL + SENSORS'}<span>{telemetry ? new Date(telemetry.timestamp).toLocaleTimeString('pt-BR') : '—'}</span></div>
      </section>
      <section className="hud-panel environment-panel"><PanelTitle title="ENV_TELEMETRY" badge="GLOBAL_NODE" /><div className="environment-card"><div><span>LOCATION</span><b>{snapshot?.settings.city || 'NÃO CONFIGURADA'}</b></div><div><span>WEATHER</span><b>{snapshot?.weather.status === 'connected' ? `${snapshot.weather.temperature}°C` : snapshot?.weather.status === 'blocked_local' ? 'LOCAL ONLY' : 'INDISPONÍVEL'}</b></div><div><span>CORE LINK</span><b className={connected ? 'cyan' : ''}>{connected ? 'CONNECTED / LOOPBACK' : 'OFFLINE'}</b></div></div><div className="panel-footnote">{snapshot?.weather.source || 'CLIMA OPCIONAL'}<span>{snapshot?.weather.timestamp ? new Date(snapshot.weather.timestamp).toLocaleTimeString('pt-BR') : 'NO GEOLOCATION'}</span></div></section>
      <div className="left-signature"><div className="tiny-bars">▁▃▅▂▆▃▁▂▅▃▆▂▁</div><span>J.A.R.V.I.S. / v0.1.0</span></div>
    </aside>

    <main className="center-stage" aria-label="Núcleo do JARVIS">
      <section className={`transmission-panel ${displayState === 'error' ? 'has-error' : ''}`} aria-label="Última transmissão"><div className="transmission-label"><Radio size={11} />LATEST TRANSMISSION</div><p aria-live="polite">{transmission.length > 260 ? transmission.slice(0, 260) + '…' : transmission}</p><div className="transmission-corners" /></section>
      <div className="core-area"><ParticleCore state={displayState} count={snapshot?.settings.quality || 8000} reduced={snapshot?.settings.reduced_motion || false} amplitude={voice.amplitude} /></div>
      <div className="voice-area"><div className="voice-orbit"><div className="voice-wave" style={{ transform: `scale(${1 + voice.amplitude * .4})` }} /><button className={`voice-button ${voice.recording ? 'recording' : ''}`} aria-label={voice.recording ? 'Encerrar gravação e enviar' : 'Iniciar comando de voz'} onClick={() => voice.recording ? void voice.stop() : void voice.start()} disabled={!connected || busy}>{voice.recording ? <Square size={21} /> : <Mic size={25} />}</button></div><div className="wake-status"><i className={`status-dot ${snapshot?.settings.voice_enabled ? '' : 'muted'}`} />{voice.recording ? 'OUVINDO · CLIQUE PARA ENVIAR' : voice.armed ? 'LISTENING FOR: “HEY JARVIS”' : 'VOICE STANDBY · CLIQUE PARA FALAR'}</div><span className="operational-state"><span className="state-line" />{labels[displayState]}<span className="state-line" /></span></div>
    </main>

    <AnimatePresence>{logsOpen && <motion.aside className="terminal-panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: .2 }} aria-label="Terminal de conversas"><div className="terminal-heading"><span><i className="status-dot" />JARVIS // TERMINAL_FEED</span><small>LIVE_LOGS</small></div><div className="terminal-body" ref={terminal} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {logs.length === 0 && <div className="terminal-empty"><div className="terminal-empty-icon"><Terminal size={24} /></div><span>AWAITING YOUR COMMAND</span><p>{connected ? 'Core conectado. Selecione uma IA nas configurações ou consulte seu hardware.' : 'O terminal exibirá conversas, ações e resultados reais quando o Core estiver conectado.'}</p><button onClick={() => action({ type: 'tool', tool: 'hardware', args: {} })} disabled={!connected}><Activity size={13} />Consultar hardware<ArrowUpRight size={13} /></button></div>}
      {logs.map(log => <article className={`log-card log-${log.role}`} key={log.id}><header><span>{log.role === 'user' ? <ChevronRight size={11} /> : log.role === 'error' ? <X size={11} /> : <Zap size={10} />}{log.role === 'user' ? 'USER_COMMAND' : log.role === 'assistant' ? 'JARVIS_AI' : log.role === 'tool' ? 'TOOL_EXECUTION' : log.role === 'error' ? 'SYSTEM_ERROR' : 'SYSTEM_EVENT'}</span><time>{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</time></header><p>{log.content}</p>{log.provider && <footer>{log.provider.toUpperCase()}{log.model && ` / ${log.model}`}</footer>}</article>)}
      {stream && <article className="log-card log-assistant streaming"><header><span><Zap size={10} />JARVIS_AI</span><span className="streaming-dots">•••</span></header><p>{stream}<span className="blink">▍</span></p></article>}
    </div><div className="terminal-footer"><i className={`status-dot ${connected ? '' : 'muted'}`} />{connected ? 'AUTHENTICATED LOCAL CORE LINK' : 'CORE LINK OFFLINE'}</div></motion.aside>}</AnimatePresence>

    <footer className="bottom-area"><div className="command-metadata"><button onClick={() => setSettingsOpen(true)}><span className="status-dot" />{activeProvider?.name.toUpperCase() || 'NO PROVIDER'}<span className="subtle">/ {activeProvider?.model || 'SELECIONE UM MODELO'}</span></button><span>{snapshot?.settings.mode === 'collaborative' ? 'COLLABORATIVE' : snapshot?.settings.mode === 'automatic' ? 'AUTO ROUTING' : 'MANUAL CONTROL'}</span></div><form className="command-bar" onSubmit={e => { e.preventDefault(); void submit(); }}><ChevronRight size={19} /><input ref={input} aria-label="Comando" placeholder="Digite um comando ou pergunte ao JARVIS…" value={command} onChange={e => setCommand(e.target.value)} maxLength={32000} disabled={!connected} autoComplete="off" /><kbd>CTRL K</kbd><button type="submit" disabled={!connected || busy || !command.trim()}><span>EXECUTE</span><Send size={13} /></button></form><div className="bottom-caption"><span><ShieldCheck size={10} />AÇÕES SENSÍVEIS EXIGEM SUA APROVAÇÃO</span><span>{snapshot?.usage ? `${snapshot.usage.input_tokens + snapshot.usage.output_tokens} TOKENS · ~$${snapshot.usage.estimated_cost.toFixed(4)} EST.${snapshot.usage.unpriced ? ' + USO SEM PREÇO' : ''}` : 'USAGE NOT AVAILABLE'}</span></div></footer>
    <button className="mobile-telemetry" aria-label="Alternar telemetria" onClick={() => setTelemetryOpen(v => !v)}><Activity size={16} /></button>
    {!window.jarvis && <div className="preview-banner">PRÉVIA DA INTERFACE · CORE DESCONECTADO</div>}
    <AnimatePresence>{notice && <motion.div className="toast" role="status" initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}><span>{notice}</span><button className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={14} /></button></motion.div>}</AnimatePresence>
    {settingsOpen && <Settings snapshot={snapshot} action={action} refresh={refresh} notify={setNotice} close={() => setSettingsOpen(false)} />}
    <Approvals approvals={snapshot?.approvals || []} action={action} />
  </div>;
}
