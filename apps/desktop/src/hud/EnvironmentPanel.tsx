import type { Snapshot } from '../../../../contracts';

export default function EnvironmentPanel({ snapshot, connected }: { snapshot: Snapshot | null; connected: boolean }) {
  const weather = snapshot?.weather;
  return <section className="hud-panel environment-panel">
    <div className="panel-heading"><span><i className="status-dot"/>ENV_TELEMETRY</span><small>GLOBAL_NODE</small></div>
    <div className="environment-card">
      <div><span>LOCATION</span><b title={snapshot?.settings.city}>{snapshot?.settings.city || 'NÃO CONFIGURADA'}</b></div>
      <div><span>WEATHER</span><b title={weather?.description}>{weather?.status === 'connected' ? <>{weather.temperature}°C <span className="weather-description">{weather.description}</span></> : weather?.status === 'blocked_local' ? 'LOCAL ONLY' : 'INDISPONÍVEL'}</b></div>
      <div><span>CORE LINK</span><b className={connected ? 'cyan' : ''}>{connected ? 'CONNECTED / LOOPBACK' : 'OFFLINE'}</b></div>
    </div>
    <div className="panel-footnote"><span title="Condições estimadas por modelos meteorológicos, consultadas na Open-Meteo.">{weather?.source || 'CLIMA OPCIONAL'}</span><span>{weather?.timestamp ? new Date(weather.timestamp).toLocaleTimeString('pt-BR') : 'NO GEOLOCATION'}</span></div>
  </section>;
}
