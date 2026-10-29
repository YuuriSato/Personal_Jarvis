import { Check, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Action, Approval } from '../../../../contracts';

export default function Approvals({ approvals, action }: { approvals: Approval[]; action: (value: Action) => Promise<any> }) {
  const approval = approvals.find(a => a.status === 'pending');
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!approval) return;
    const previous = document.activeElement as HTMLElement | null;
    card.current?.querySelector<HTMLElement>('[data-default="deny"]')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || []);
      const first = controls[0], last = controls.at(-1);
      event.stopImmediatePropagation();
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); previous?.focus(); };
  }, [approval?.id]);
  if (!approval) return null;
  return <div className="approval-overlay"><section ref={card} className="approval-card" role="alertdialog" aria-modal="true" aria-label="Aprovação de ferramenta">
    <div className="eyebrow"><ShieldAlert size={16} />HUMAN AUTHORIZATION REQUIRED</div>
    <h2>Uma ação precisa de você.</h2><p>{approval.summary}</p>
    <div className="approval-tool">{approval.tool}</div><pre>{JSON.stringify(approval.args, null, 2)}</pre>
    <p className="fine-print">Destino da execução: {(approval as any).provider || 'local'}. Ao aprovar leitura, o conteúdo pode ser enviado à IA ativa. Válida até {new Date(approval.expires_at).toLocaleTimeString('pt-BR')}.</p>
    <div className="row"><button className="primary" onClick={() => action({ type: 'approve', id: approval.id, approved: true })}><Check size={15} />Aprovar esta ação</button><button data-default="deny" className="secondary danger" onClick={() => action({ type: 'approve', id: approval.id, approved: false })}><X size={15} />Negar</button></div>
  </section></div>;
}
