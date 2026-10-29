import { Cpu, Download, CheckCircle2 } from 'lucide-react';
import type { Action, Provider } from '../../../../contracts';

export default function LMStudioStatus({ provider, action, pending, run, notify }: {
  provider: Provider; action: (a: Action) => Promise<any>; pending: string;
  run: (label: string, job: () => Promise<any>) => Promise<void>; notify: (message: string) => void;
}) {
  const model = provider.models.find(m => m.id === provider.model);
  const loaded = provider.models.filter(m => m.state === 'loaded' && m.kind !== 'embedding');
  return <div className="lmstudio-status">
    <h4>LM Studio · estado real do servidor</h4>
    <div className="status-box"><Cpu size={16} /><div>{loaded.length ? `${loaded.length} modelo(s) de conversa carregado(s)` : 'Nenhum modelo de conversa carregado.'}<p className="fine-print">{provider.models.filter(m => m.kind !== 'embedding').length} modelos de conversa · {provider.models.filter(m => m.kind === 'embedding').length} de embeddings · {provider.models[0]?.metadata_source || 'consulte o servidor'}</p></div></div>
    {model && <>
      <div className="row between"><strong>{model.name}</strong><span className="eyebrow">{model.state === 'loaded' ? 'CARREGADO' : model.state === 'unloaded' ? 'BAIXADO / NÃO CARREGADO' : 'ESTADO NÃO INFORMADO'}</span></div>
      <p className="fine-print">{model.size_bytes ? `${(model.size_bytes / 1024 ** 3).toFixed(2)} GB · ` : ''}{model.capabilities.includes('tools') ? 'Suporte a ferramentas informado pelo LM Studio' : 'Sem suporte confirmado a ferramentas; conversa permanece disponível.'}</p>
      {model.state === 'unloaded' && <button className="primary" disabled={!!pending || !provider.enabled} onClick={() => run('lmstudio-load', async () => {
        const result = await action({ type: 'lmstudio_load', text: model.id });
        if (result?.status === 'loaded') notify('Modelo carregado no LM Studio. Clique em Usar LM Studio para conversar.');
      })}><Download size={15} />{pending === 'lmstudio-load' ? 'Carregando na memória…' : 'Carregar modelo selecionado'}</button>}
      {model.state === 'loaded' && <div className="status-box"><CheckCircle2 size={15} />Pronto para conversar pelo servidor local.</div>}
      <p className="fine-print">Carregar usa RAM/VRAM e exige este clique explícito. Não baixa pesos nem solicita o encerramento de outros modelos ou mudanças nas configurações globais do LM Studio.</p>
    </>}
  </div>;
}
