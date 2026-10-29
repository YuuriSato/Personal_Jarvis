import { useEffect, useRef, useState } from 'react';
import { X, Shield, KeyRound, Server, Mic, Brain, FolderLock, Download, RefreshCw, Trash2, Check, Plus, ChevronRight } from 'lucide-react';
import type { Action, JarvisSettings, Provider, ProviderId, Snapshot } from '../../../../contracts';
import LMStudioStatus from './LMStudioStatus';
import { version } from '../../../../package.json';

interface Props { snapshot: Snapshot | null; action: (a: Action) => Promise<any>; refresh: () => Promise<void>; notify: (text: string) => void; close: () => void; }
function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export default function Settings({ snapshot, action, refresh, notify, close }: Props) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || []).filter(e => e.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); previous?.focus(); };
  }, []);
  const [tab, setTab] = useState('providers');
  const [selected, setSelected] = useState<ProviderId>('lmstudio');
  const [key, setKey] = useState('');
  const [pending, setPending] = useState('');
  const [memory, setMemory] = useState('');
  const [expiry, setExpiry] = useState('');
  const [editingMemory, setEditingMemory] = useState('');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [cities, setCities] = useState<Array<{name: string; region: string; country: string; latitude: number; longitude: number}>>([]);
  const [cityQuery, setCityQuery] = useState('');
  const settings = snapshot?.settings;
  const provider = snapshot?.providers.find(p => p.id === selected);
  const update = (values: Partial<JarvisSettings>) => action({ type: 'settings', settings: values });
  const configure = (values: Partial<Provider>) => action({ type: 'provider', provider: selected, config: values });
  const run = async (label: string, job: () => Promise<any>) => { setPending(label); try { await job(); } catch (e) { notify((e as Error).message); } finally { setPending(''); } };
  const tabs = [ ['providers', Server, 'Inteligências'], ['security', Shield, 'Privacidade'], ['voice', Mic, 'Voz e núcleo'], ['memory', Brain, 'Memória'], ['tools', FolderLock, 'Ferramentas'] ] as const;
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true" aria-label="Configurações do JARVIS">
      <header className="dialog-title"><div><span className="eyebrow">JARVIS / CONTROL CENTER</span><h2>Configuração do sistema<span>_</span></h2></div><button className="icon-button" onClick={close} aria-label="Fechar configurações"><X size={20} /></button></header>
      <div className="settings-layout"><nav className="settings-tabs">{tabs.map(([id, Icon, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span><ChevronRight size={12} /></button>)}</nav>
      <div className="settings-content">
        {!snapshot || !settings ? <div className="empty-state"><Server /><h3>Core desconectado</h3><p>Abra o aplicativo desktop com o serviço local para configurar provedores e ferramentas.</p><button onClick={() => refresh()}>Tentar novamente</button></div> : <>
        {tab === 'providers' && <>
          <div className="section-intro"><span className="eyebrow">MULTI-MODEL HUB</span><h3>Escolha a inteligência.</h3><p>Somente provedores habilitados podem receber conteúdo. Nenhum modelo é baixado automaticamente.</p></div>
          <div className="provider-tabs">{snapshot.providers.map(p => <button key={p.id} onClick={() => { setSelected(p.id); setKey(''); }} className={p.id === selected ? 'active' : ''}><i className={`status-dot ${p.enabled ? '' : 'muted'}`} />{p.name}</button>)}</div>
          {provider && <div key={selected} className="provider-config">
            <div className="row between"><div className="provider-heading"><Server size={22} /><div><h3>{provider.name}</h3><small>{provider.local ? 'Servidor local · endereço de loopback' : 'Nuvem · conteúdo enviado ao provedor'}</small></div></div><label className="toggle"><input type="checkbox" checked={provider.enabled} onChange={e => configure({ enabled: e.target.checked })} /><span />Habilitar</label></div>
            <div className="status-box"><i className={`status-dot ${provider.status === 'connected' ? '' : 'muted'}`} />{provider.status === 'connected' ? 'Conexão e lista de modelos verificadas' : provider.status === 'unavailable' ? 'Servidor indisponível ou credencial inválida' : 'Integração ainda não validada'}</div>
            {provider.local && <label>Endereço do servidor<input aria-label="Endereço do servidor" defaultValue={provider.base_url} onBlur={e => { if (e.target.value !== provider.base_url) configure({ base_url: e.target.value }); }} /></label>}
            <label>API key <span className="subtle">{provider.has_key ? '· cadastrada no cofre' : provider.local ? '· opcional' : '· necessária'}</span><div className="input-row"><KeyRound size={16} /><input type="password" autoComplete="off" placeholder="Cadastrar ou substituir credencial" value={key} onChange={e => setKey(e.target.value)} aria-label="API key" /><button disabled={!key || !!pending} onClick={() => run('key', async () => { if (!window.jarvis) return; await window.jarvis.saveKey(selected, key); setKey(''); await refresh(); notify('Credencial protegida pelo sistema operacional.'); })}>{pending === 'key' ? 'Salvando…' : 'Salvar'}</button></div></label>
            {provider.has_key && <button className="text-button danger" onClick={() => run('key', async () => { await window.jarvis?.removeKey(selected); await refresh(); })}><Trash2 size={13} />Remover credencial</button>}
            <div className="row between"><label className="grow">Modelo<select aria-label="Modelo" value={provider.model} onChange={e => configure({ model: e.target.value, input_price: null, output_price: null, price_date: '' })}><option value="">Selecione um modelo</option>{provider.model && !provider.models.some(m => m.id === provider.model) && <option value={provider.model}>{provider.model} · cache</option>}{provider.models.filter(m => m.kind !== 'embedding').map(m => <option key={m.id} value={m.id} disabled={m.cloud}>{m.name}{m.state === 'loaded' ? ' · carregado' : m.state === 'unloaded' ? ' · não carregado' : ''}</option>)}</select></label><button className="secondary" disabled={!!pending || !provider.enabled} onClick={() => run('models', () => action({ type: 'models', provider: selected }))}><RefreshCw size={14} className={pending === 'models' ? 'spin' : ''} />Consultar modelos</button></div>
            {selected === 'lmstudio' && <LMStudioStatus provider={provider} action={action} pending={pending} run={run} notify={notify} />}
            <p className="fine-print">Texto e streaming são as capacidades iniciais. Ferramentas dependem do modelo; incompatibilidades aparecem como erro real, sem execução alternativa.</p>
            {!provider.local && <><h4>Estimativa de custo · USD por milhão de tokens</h4><div className="form-grid"><label>Entrada<input type="number" min="0" step="0.01" defaultValue={provider.input_price ?? ''} onBlur={e => configure({ input_price: e.target.value === '' ? null : Number(e.target.value) })} /></label><label>Saída<input type="number" min="0" step="0.01" defaultValue={provider.output_price ?? ''} onBlur={e => configure({ output_price: e.target.value === '' ? null : Number(e.target.value) })} /></label><label>Data do preço<input type="date" defaultValue={provider.price_date} onBlur={e => configure({ price_date: e.target.value })} /></label></div><p className="fine-print">Preços informados por você para o modelo selecionado. A estimativa não substitui a fatura do provedor.</p></>}
            <button className="primary" disabled={!provider.model || !provider.enabled} onClick={() => update({ provider: selected, mode: 'manual' })}><Check size={15} />Usar {provider.name}</button>
          </div>}
        </>}
        {tab === 'security' && <>
          <div className="section-intro"><span className="eyebrow">HUMAN IN CONTROL</span><h3>Você define os limites.</h3><p>Permissões são aplicadas pelo aplicativo. Modelos e arquivos não podem conceder acesso.</p></div>
          <label className="setting-card"><div><strong>Somente local</strong><p>Bloqueia IAs remotas, clima e downloads de voz. Modelos Ollama em nuvem também são bloqueados.</p></div><input type="checkbox" checked={settings.local_only} onChange={e => update({ local_only: e.target.checked })} /></label>
          <label>Modo de operação<select value={settings.mode} onChange={e => update({ mode: e.target.value as JarvisSettings['mode'] })}><option value="manual">Manual · modelo escolhido, sem troca silenciosa</option><option value="automatic">Automático · modelos habilitados, locais primeiro</option><option value="collaborative">Colaborativo · análise, revisão e síntese</option></select></label><p className="fine-print">Com um único modelo local disponível, a colaboração usa dois papéis no mesmo modelo e identifica isso no terminal. Com vários provedores elegíveis, distribui as análises entre eles.</p>
          <div className="form-grid"><label>Orçamento diário estimado · USD<input type="number" min="0.01" step="0.1" defaultValue={settings.daily_budget ?? ''} onBlur={e => update({ daily_budget: e.target.value ? Number(e.target.value) : null })} /></label><label>Limite de tokens por resposta<input type="number" min="128" max="8192" defaultValue={settings.max_output_tokens} onBlur={e => update({ max_output_tokens: Number(e.target.value) })} /></label></div>
          <p className="fine-print">O orçamento é estimado e contabilizado por dia UTC. Automação em nuvem exige orçamento, preços e data configurados. Uso interrompido sem medição é marcado como desconhecido.</p>
          <h4>Clima opcional · Open-Meteo</h4><label className="setting-card"><div><strong>Consultar clima</strong><p>Envia as coordenadas informadas à Open-Meteo a cada 15 minutos.</p></div><input type="checkbox" checked={settings.weather_enabled} onChange={e => update({ weather_enabled: e.target.checked })} /></label>
          <label>Buscar cidade<div className="input-row"><input value={cityQuery} onChange={e => setCityQuery(e.target.value)} placeholder="Ex.: Osasco, SP"/><button disabled={!!pending || cityQuery.trim().length<2 || settings.local_only} onClick={() => run('cities', async () => { const result = await action({ type: 'weather_search', text: cityQuery }); setCities(result?.cities || []); })}>Buscar</button></div></label>
          <div className="city-results">{cities.map(city => <button key={`${city.latitude},${city.longitude}`} onClick={async () => { await update({ city: `${city.name}, ${city.region}`, latitude: city.latitude, longitude: city.longitude, weather_enabled: true }); setCities([]); }}>{city.name} · {city.region} · {city.country}</button>)}</div>
          <label>Cidade<input defaultValue={settings.city} placeholder="Sua cidade" onBlur={e => update({ city: e.target.value })} /></label><div className="form-grid"><label>Latitude<input type="number" min="-90" max="90" step="any" defaultValue={settings.latitude ?? ''} onBlur={e => update({ latitude: e.target.value ? Number(e.target.value) : null })} /></label><label>Longitude<input type="number" min="-180" max="180" step="any" defaultValue={settings.longitude ?? ''} onBlur={e => update({ longitude: e.target.value ? Number(e.target.value) : null })} /></label></div>
          <button className="secondary" disabled={!!pending || !settings.weather_enabled} onClick={() => run('weather', async () => { const result = await action({ type: 'weather_refresh' }); if (result) notify(result.status === 'connected' ? `${result.temperature}°C · ${result.description} · Open-Meteo` : 'Clima indisponível; confira cidade, coordenadas e rede.'); })}><RefreshCw size={14}/>Atualizar clima agora</button>
        </>}
        {tab === 'voice' && <>
          <div className="section-intro"><span className="eyebrow">VOICE & VISUAL CORE</span><h3>Uma presença responsiva.</h3><p>A expressão é simulada. O estado operacional e o áudio são reais.</p></div>
          <label>Personalidade<select value={settings.personality} onChange={e => update({ personality: e.target.value as JarvisSettings['personality'] })}><option value="cordial">Cordial</option><option value="objective">Objetivo</option><option value="witty">Bem-humorado</option><option value="supportive">Acolhedor</option></select></label>
          <label>Partículas<select value={settings.quality} onChange={e => update({ quality: Number(e.target.value) as JarvisSettings['quality'] })}><option value="4000">4.000 · econômico</option><option value="8000">8.000 · equilibrado</option><option value="16000">16.000 · detalhado</option></select></label>
          <label className="setting-card"><div><strong>Movimento reduzido</strong><p>Reduz animações do rosto, arcos e painéis.</p></div><input type="checkbox" checked={settings.reduced_motion} onChange={e => update({ reduced_motion: e.target.checked })} /></label>
          <label className="setting-card"><div><strong>Habilitar voz local</strong><p>Microfone somente ao usar o botão ou ativar a wake word. Sem gravação permanente.</p></div><input type="checkbox" checked={settings.voice_enabled} onChange={e => update({ voice_enabled: e.target.checked })} /></label>
          <div className="status-box"><Mic size={15} />{snapshot.voice.reason}</div>
          <button className="secondary" disabled={!!pending || !snapshot.voice.available || settings.local_only} onClick={() => run('voice', () => action({ type: 'voice_prepare' }))}><Download size={15} />{pending === 'voice' ? 'Preparando modelo…' : 'Baixar modelo local de transcrição'}</button><p className="fine-print">Download explícito do faster-whisper-base (Hugging Face). Depois de preparado, a transcrição roda localmente em CPU.</p>
          <label className="setting-card"><div><strong>Responder com voz</strong><p>Utiliza a voz local preparada no JARVIS ou instalada no Windows. Pode ser interrompida.</p></div><input type="checkbox" checked={settings.auto_speak} disabled={!settings.voice_enabled} onChange={e => update({ auto_speak: e.target.checked })} /></label>
          <div className="status-box"><Mic size={15}/>{snapshot.voice.tts_name}{snapshot.voice.piper_ready ? ' · pronta para uso offline' : ''}</div>
          <button className="secondary" disabled={!!pending || settings.local_only} onClick={() => run('tts', () => action({ type: 'voice_prepare_tts' }))}><Download size={14}/>{pending === 'tts' ? 'Preparando fala…' : snapshot.voice.piper_ready ? 'Verificar voz em português' : 'Preparar voz em português'}</button>
          <button className="secondary" disabled={!!pending || !settings.voice_enabled} onClick={() => action({ type: 'voice_speak', text: 'Olá! Sou o Jarvis. A voz em português está pronta para ajudar.' })}><Mic size={14}/>Testar resposta falada</button>
          <h4>Ativação local</h4><button className="secondary" disabled={!!pending || settings.local_only} onClick={() => run('wake-model', () => action({ type: 'voice_prepare_wake' }))}><Download size={14}/>{snapshot.voice.wake_model_ready ? 'Verificar modelo Hey Jarvis' : 'Preparar modelo Hey Jarvis'}</button>
          <label>Sensibilidade da ativação<input type="range" min="0.3" max="0.95" step="0.05" value={settings.wake_threshold ?? .65} onChange={e => update({ wake_threshold: Number(e.target.value) })}/><small>Limiar: {(settings.wake_threshold ?? .65).toFixed(2)} · valores maiores reduzem ativações indevidas.</small></label>
          {!snapshot.voice.tts_portuguese && <div className="status-box">Nenhuma voz SAPI em português detectada. Instale uma voz em português nas configurações de fala do Windows para melhorar a pronúncia. Vozes atuais: {snapshot.voice.tts_voices.map(v => v.name).join(', ') || 'indisponíveis'}.</div>}
          <label className="setting-card"><div><strong>Wake word “Hey Jarvis”</strong><p>Mantém o microfone ativo e detecta localmente. A primeira ativação baixa o modelo openWakeWord, sujeito à licença de uso pessoal.</p></div><input type="checkbox" checked={settings.wake_word} disabled={!settings.voice_enabled || !snapshot.voice.wake_available || !!pending} onChange={e => run('wake', () => update({ wake_word: e.target.checked }))} /></label>
        </>}
        {tab === 'memory' && <>
          <div className="section-intro"><span className="eyebrow">PERSISTENT MEMORY</span><h3>O que você escolhe lembrar.</h3><p>Memórias são enviadas ao modelo selecionado junto ao contexto. Guarde apenas informações que deseja compartilhar com ele.</p></div>
          <label>Preferência ou fato consentido<textarea value={memory} onChange={e => setMemory(e.target.value)} placeholder="Ex.: prefiro respostas curtas em português." maxLength={10000} /></label><label>Expiração opcional<input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
          <button className="primary" disabled={!memory.trim()} onClick={async () => { const result = await action({ type: 'memory', content: memory, id: editingMemory || undefined, expires_at: expiry ? new Date(expiry).toISOString() : null }); if (result?.ok) { setMemory(''); setExpiry(''); setEditingMemory(''); } }}><Plus size={15} />{editingMemory ? 'Salvar edição' : 'Memorizar com meu consentimento'}</button>
          <input aria-label="Buscar memórias" placeholder="Buscar memórias…" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="memory-list">{snapshot.memories.filter(m => m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(m => <article key={m.id}><p>{m.content}</p><small>{new Date(m.created_at).toLocaleString('pt-BR')}{m.expires_at && ` · expira ${new Date(m.expires_at).toLocaleString('pt-BR')}`}</small><div className="row"><button className="text-button" onClick={() => { setMemory(m.content); setEditingMemory(m.id); setExpiry(m.expires_at ? localDateTime(m.expires_at) : ''); }}>Editar</button><button className="text-button danger" onClick={() => action({ type: 'memory_delete', id: m.id })}>Excluir</button></div></article>)}</div>
          <h4>Busca semântica local · opcional</h4>
          <label className="setting-card"><div><strong>Recuperar memórias por significado</strong><p>Usa um modelo de embeddings local configurado por você. Nenhum conteúdo é enviado a um serviço remoto por este recurso.</p></div><input type="checkbox" checked={settings.semantic_memory_enabled} onChange={e => update({ semantic_memory_enabled: e.target.checked })} /></label>
          <div className="form-grid"><label>Servidor de embeddings<select value={settings.embedding_provider} onChange={e => update({ embedding_provider: e.target.value as 'lmstudio' | 'ollama' })}><option value="lmstudio">LM Studio</option><option value="ollama">Ollama</option></select></label><label>Modelo local de embeddings<input defaultValue={settings.embedding_model} placeholder="ID do modelo já disponível" onBlur={e => update({ embedding_model: e.target.value })} /></label></div>
          <button className="secondary" disabled={!!pending || !settings.embedding_model} onClick={() => run('index', async () => { const result = await action({ type: 'memory_index' }); if (result) notify(`${result.indexed} memórias indexadas localmente.`); })}><Brain size={14} />{pending === 'index' ? 'Indexando…' : 'Indexar memórias consentidas'}</button>
          {settings.embedding_provider === 'lmstudio' && <button className="secondary" disabled={!!pending || !settings.embedding_model} onClick={() => run('embedding-load', async () => { const result = await action({ type: 'lmstudio_load', text: settings.embedding_model }); if (result?.status === 'loaded') notify('Modelo de embeddings carregado no LM Studio.'); })}><Download size={14} />Carregar modelo de embeddings</button>}
          <h4>Histórico e auditoria</h4><div className="row"><button className="secondary" onClick={() => run('export', async () => { if (await window.jarvis?.exportData()) notify('Exportação concluída sem credenciais.'); })}><Download size={14} />Exportar dados</button><button className="secondary danger" onClick={() => setConfirmClear(true)}><Trash2 size={14} />Limpar conversas</button></div>{confirmClear && <div className="inline-confirm"><p>Excluir todas as conversas? A auditoria resumida e as memórias serão preservadas.</p><button className="danger" onClick={async () => { await action({ type: 'history_clear' }); setConfirmClear(false); }}>Excluir conversas</button><button onClick={() => setConfirmClear(false)}>Cancelar</button></div>}
        </>}
        {tab === 'tools' && <>
          <div className="section-intro"><span className="eyebrow">EXECUTION BOUNDARIES</span><h3>Permissões explícitas.</h3><p>Leitura, criação e movimentação de arquivos exigem uma pasta concedida e aprovação da ação exata. Shell genérico e exclusão estão bloqueados.</p></div>
          <h4>Pastas concedidas</h4>{settings.allowed_roots.map(root => <div className="permission-row" key={root}><FolderLock size={15} /><code>{root}</code><button className="icon-button" aria-label={`Revogar ${root}`} onClick={() => update({ allowed_roots: settings.allowed_roots.filter(p => p !== root) })}><X size={14} /></button></div>)}<button className="secondary" onClick={() => run('folder', async () => { const root = await window.jarvis?.chooseFolder(); if (root) await update({ allowed_roots: [...new Set([...settings.allowed_roots, root])] }); })}><Plus size={14} />Conceder pasta</button>
          <h4>Aplicativos permitidos</h4>{Object.entries(settings.apps).map(([name, file]) => <div className="permission-row" key={name}><Server size={14} /><code>{name}<small>{file}</small></code><button className="icon-button" aria-label={`Revogar ${name}`} onClick={() => { const apps = { ...settings.apps }; delete apps[name]; update({ apps }); }}><X size={14} /></button></div>)}<button className="secondary" onClick={() => run('app', async () => { const file = await window.jarvis?.chooseApp(); if (file) { const name = file.split(/[\\/]/).pop()!.replace(/\.exe$/i, ''); await update({ apps: { ...settings.apps, [name]: file } }); } })}><Plus size={14} />Permitir aplicativo</button>
          <div className="status-box"><Shield size={16} />Aprovações são de uso único e expiram em cinco minutos. Nenhum resultado externo concede permissões.</div>
        </>}
        </>}
      </div></div>
      <footer className="dialog-footer"><Shield size={12} />CREDENCIAIS NO COFRE DO SISTEMA<span>JARVIS v{version}</span></footer>
    </section>
  </div>;
}
