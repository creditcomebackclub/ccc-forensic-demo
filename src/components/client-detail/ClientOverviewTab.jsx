import React from 'react';
import { FileText, Scale, CreditCard, ShieldCheck, ChevronRight, Mail } from 'lucide-react';
import { hasCustomServiceAgreement } from '../../utils/pricing';
import ClientEmailHistory from './ClientEmailHistory.jsx';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

function Panel({ title, icon, children, action }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid ' + T.border, boxShadow: T.cardShadow }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid ' + T.grid }}>
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="ccc-display text-[13px] font-semibold uppercase tracking-wider" style={{ color: T.navy }}>{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function CheckRow({ ok, label }) {
  return (
    <div className="flex items-center gap-2 text-[12px] py-1">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: ok ? '#16A34A' : '#D1D5DB' }}
      />
      <span style={{ color: ok ? T.ink : T.faint }}>{label}</span>
    </div>
  );
}

export default function ClientOverviewTab({
  client,
  isAdmin,
  campaignSummary,
  phaseRows = [],
  onOpenAudit,
  onCompareReports,
  onGoTab,
  fmtTime,
}) {
  const c = client;
  const ledger = Array.isArray(c.ledger) ? c.ledger : [];
  const balanceDue = ledger.reduce((sum, tx) => {
    if (tx.type === 'Invoice' && tx.status !== 'Paid') return sum + (parseFloat(tx.amount) || 0);
    return sum;
  }, 0);
  const packageLabel = hasCustomServiceAgreement(c)
    ? (c.serviceAgreementLabel || 'Custom package')
    : (c.billingTier || 'No tier set');
  const packageAmt = hasCustomServiceAgreement(c) && c.serviceAgreementAmount != null
    ? `$${Number(c.serviceAgreementAmount).toFixed(2)}`
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel
        title="Audits"
        icon={<FileText size={14} style={{ color: T.gold }} />}
        action={
          c.audits?.length >= 2 ? (
            <button
              type="button"
              onClick={onCompareReports}
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: T.navy }}
            >
              Compare reports →
            </button>
          ) : null
        }
      >
        {!c.audits?.length ? (
          <p className="text-[12px]" style={{ color: T.muted }}>No audits yet.</p>
        ) : (
          <div className="space-y-0">
            {c.audits.slice(0, 4).map((a, i) => (
              <div
                key={a.id}
                className="flex items-center justify-between py-2.5 gap-2"
                style={{ borderTop: i === 0 ? 'none' : '1px solid ' + T.grid }}
              >
                <div className="text-[12px] min-w-0" style={{ color: T.ink }}>
                  Report {a.reportDate}
                  <span style={{ color: T.muted }}>
                    {' '}· {(a.audit && a.audit.accountsTargeted) || 0} accounts · {(a.audit && a.audit.totalViolations) || 0} violations
                  </span>
                  {isAdmin && a.auditorName && (
                    <span className="text-[11px]" style={{ color: T.faint }}> · {a.auditorName}</span>
                  )}
                  <div className="text-[10px]" style={{ color: T.faint }}>{fmtTime?.(a.savedAt)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenAudit(a.clientId ? { ...a.audit, client: { ...a.audit.client, id: a.clientId } } : a.audit)}
                  className="text-[10px] uppercase tracking-wider font-bold shrink-0 px-2.5 py-1 rounded-md"
                  style={{ background: T.navy, color: T.gold }}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Campaign progress"
        icon={<Scale size={14} style={{ color: T.gold }} />}
        action={
          <button type="button" onClick={() => onGoTab?.('Letters')} className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-0.5" style={{ color: T.navy }}>
            Letters <ChevronRight size={12} />
          </button>
        }
      >
        {!campaignSummary || campaignSummary.total === 0 ? (
          <p className="text-[12px]" style={{ color: T.muted }}>
            Run Report Comparison after a follow-up audit to see Phase 1–4 by account.
          </p>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              {[1, 2, 3, 4].map((p) => (
                <div key={p} className="flex-1 rounded-lg px-2 py-2 text-center" style={{ background: '#F8FAFC', border: '1px solid ' + T.grid }}>
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: T.faint }}>Ph {p}</div>
                  <div className="ccc-display text-[18px] font-semibold" style={{ color: T.navy }}>{campaignSummary.byPhase[p] || 0}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {phaseRows.slice(0, 8).map((row) => (
                <div key={row.accountKey} className="flex items-start justify-between gap-2 text-[11px]">
                  <span className="truncate" style={{ color: T.ink }}>{row.furnisher}</span>
                  <span className="shrink-0" style={{ color: T.muted }}>Phase {row.phase} · {row.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Billing"
        icon={<CreditCard size={14} style={{ color: T.gold }} />}
        action={
          <button type="button" onClick={() => onGoTab?.('Billing')} className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.navy }}>
            Open →
          </button>
        }
      >
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between"><span style={{ color: T.muted }}>Status</span><span style={{ color: T.ink }}>{c.billingStatus || 'Active'}</span></div>
          <div className="flex justify-between gap-2"><span style={{ color: T.muted }}>Package</span><span className="text-right" style={{ color: T.ink }}>{packageLabel}{packageAmt ? ` · ${packageAmt}` : ''}</span></div>
          <div className="flex justify-between"><span style={{ color: T.muted }}>Amount due</span><span style={{ color: balanceDue > 0 ? '#DC2626' : T.ink, fontWeight: 600 }}>${balanceDue.toFixed(2)}</span></div>
        </div>
      </Panel>

      <Panel
        title="Readiness"
        icon={<ShieldCheck size={14} style={{ color: T.gold }} />}
        action={
          <button type="button" onClick={() => onGoTab?.('Profile')} className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.navy }}>
            Profile →
          </button>
        }
      >
        <CheckRow ok={!!c.lpoaSigned} label="LPOA signed" />
        <CheckRow ok={!!c.portalOnboarded} label="Portal onboarding complete" />
        <CheckRow ok={!!c.email} label="Email on file" />
        <CheckRow ok={(c.letters || []).length > 0} label="Letters generated" />
        <button
          type="button"
          onClick={() => onGoTab?.('Documents')}
          className="mt-3 text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: T.navy }}
        >
          Documents →
        </button>
      </Panel>

      <Panel title="Client email history" icon={<Mail size={14} style={{ color: T.gold }} />}>
        <ClientEmailHistory clientId={c.id} />
      </Panel>
    </div>
  );
}
