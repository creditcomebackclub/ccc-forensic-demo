import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import {
  CheckCircle2, CheckCircle, Download, ArrowRight, Sparkles, MapPin, Calendar,
  FileWarning, AlertTriangle, Eye, ChevronRight, Mail, Scale,
} from 'lucide-react';

function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function TypeBadge({ type }) {
  const tone = type === 'A' ? 'navy' : type === 'B' ? 'gold' : 'red';
  return <Pill tone={tone}>Type {type}</Pill>;
}

function SeverityBar({ severity }) {
  const count = severity === 'high' ? 3 : severity === 'med' ? 2 : 1;
  const color = severity === 'high' ? '#C44A3F' : severity === 'med' ? '#D89821' : '#9B9B95';
  return (
    <div className="flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-0.5 h-3 rounded-sm"
          style={{ backgroundColor: i < count ? color : '#E8E6DF' }}
        />
      ))}
    </div>
  );
}

export default function AuditResults({ audit, onGenerateLetter, onReset }) {
  const [existingLetters, setExistingLetters] = React.useState(new Set());

  React.useEffect(() => {
    const clientName = audit && audit.client && audit.client.name;
    if (!clientName) return;
    supabase.from('letters').select('furnisher').eq('client_name', clientName)
      .then(({ data }) => {
        console.log('letters query result:', data, 'for client:', clientName);
        if (data) setExistingLetters(new Set(data.map((l) => (l.furnisher || '').toLowerCase().trim())));
      });
  }, [audit && audit.client && audit.client.name]);
  const [selectedAccount, setSelectedAccount] = useState(null);

  const totalBalance = audit.accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const batch1 = audit.accounts.filter((a) => a.batch === 1);
  const batch2 = audit.accounts.filter((a) => a.batch === 2);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Success banner */}
      <div className="border rounded p-5 flex items-center gap-3 bg-green-50 border-green-200">
        <CheckCircle2 size={20} className="text-green-700" />
        <div className="flex-1">
          <div className="text-[14px] font-medium text-ink">Forensic audit complete</div>
          <div className="text-[12px] text-ink-muted">
            {audit.accountsTargeted} accounts targeted · {audit.totalViolations} violations identified · Phase 1 letter strategy ready
          </div>
        </div>
        <button
          onClick={onReset}
          className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-sm border border-border text-ink-muted hover:bg-gray-50"
        >
          New audit
        </button>
      </div>

      {/* Client info */}
      <div className="bg-white border border-border rounded p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="ccc-display text-2xl text-ink font-medium">
              {audit.client?.name || 'Unknown Client'}
            </h1>
            <div className="flex items-center gap-4 text-[12px] text-ink-muted mt-1">
              {audit.client?.address && (
                <span className="flex items-center gap-1">
                  <MapPin size={11} /> {audit.client.address}
                </span>
              )}
              {audit.client?.reportDate && (
                <span className="flex items-center gap-1">
                  <Calendar size={11} /> Report {audit.client.reportDate}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Score row */}
        <div className="grid grid-cols-6 gap-6 pt-4 border-t border-border">
          {[
            { label: 'Equifax', val: audit.scores?.equifax },
            { label: 'Experian', val: audit.scores?.experian },
            { label: 'TransUnion', val: audit.scores?.transunion },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-[10px] uppercase tracking-[0.15em] text-ink-faint">{s.label}</div>
              <div className="ccc-mono text-2xl text-ink mt-0.5">{s.val ?? '—'}</div>
            </div>
          ))}
          <div className="border-l border-border pl-6">
            <div className="text-[10px] uppercase tracking-[0.15em] text-ink-faint">Accounts</div>
            <div className="ccc-mono text-2xl text-ink mt-0.5">{audit.accountsTargeted}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-ink-faint">Violations</div>
            <div className="ccc-mono text-2xl text-gold-dark mt-0.5">{audit.totalViolations}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-ink-faint">Total Balance</div>
            <div className="ccc-mono text-2xl text-ink mt-0.5">
              ${totalBalance.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Executive summary */}
      {audit.executiveSummary && (
        <div className="bg-navy-dark text-white rounded p-5">
          <div className="flex items-center gap-2 mb-2">
            <Scale size={14} className="text-gold" strokeWidth={1.75} />
            <h3 className="ccc-display text-sm font-medium">Executive Summary</h3>
          </div>
          <p className="text-[13px] text-gray-300 leading-relaxed">{audit.executiveSummary}</p>
        </div>
      )}

      {/* Round 1 Batch 1 */}
      <AccountTable
        title="Round 1 — Batch 1"
        subtitle="Top accounts by balance × violation strength · Send now"
        accounts={batch1}
        onSelect={setSelectedAccount}
        onGenerateLetter={onGenerateLetter} existingLetters={existingLetters}
        emphasis
      />

      {/* Round 1 Batch 2 */}
      {batch2.length > 0 && (
        <AccountTable
          title="Round 1 — Batch 2"
          subtitle="Staggered for postage cost control · Send next"
          accounts={batch2}
          onSelect={setSelectedAccount}
          onGenerateLetter={onGenerateLetter} existingLetters={existingLetters}
        />
      )}

      {/* Violations by type */}
      {audit.violationsByType?.length > 0 && (
        <div className="bg-white border border-border rounded">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="ccc-display text-[15px] text-ink font-medium">Violations by Type</h2>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium text-ink-faint">
                  Violation Type
                </th>
                <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium text-ink-faint">
                  Statute
                </th>
                <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium text-ink-faint">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {audit.violationsByType.map((v, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-5 py-3 text-ink">{v.type}</td>
                  <td className="px-5 py-3 ccc-mono text-navy text-[11px]">{v.statute}</td>
                  <td className="px-5 py-3 text-right ccc-mono text-gold-dark">×{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Account detail modal-ish */}
      {selectedAccount && (
        <AccountDetail
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
          onGenerateLetter={onGenerateLetter} existingLetters={existingLetters}
        />
      )}
    </div>
  );
}

function AccountTable({ title, subtitle, accounts, onSelect, onGenerateLetter, emphasis, existingLetters = new Set() }) {
  return (
    <div className="bg-white border border-border rounded">
      <div className={`px-5 py-3.5 border-b border-border ${emphasis ? 'bg-navy-dark text-white' : ''}`}>
        <h2 className={`ccc-display text-[15px] font-medium ${emphasis ? 'text-white' : 'text-ink'}`}>
          {title}
        </h2>
        <p className={`text-[11px] mt-0.5 ${emphasis ? 'text-gray-300' : 'text-ink-muted'}`}>
          {subtitle}
        </p>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            {['Furnisher', 'Type', 'Status', 'Balance', 'Violations', 'Primary Hook', 'Address', ''].map(
              (h) => (
                <th
                  key={h}
                  className="text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium text-ink-faint"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr
              key={a.id}
              className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
              onClick={() => onSelect(a)}
            >
              <td className="px-5 py-3.5">
                <div className="font-medium text-ink">{a.furnisher}</div>
                <div className="text-[10px] text-ink-faint mt-0.5 ccc-mono">{a.accountNumberMasked}</div>
              </td>
              <td className="px-5 py-3.5">
                <TypeBadge type={a.type} />
              </td>
              <td className="px-5 py-3.5 text-[11px] text-ink-muted">{a.status}</td>
              <td className="px-5 py-3.5 ccc-mono text-ink">${a.balance?.toLocaleString() || 0}</td>
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-1.5">
                  <span className="ccc-mono text-gold-dark font-medium">{a.violations?.length || 0}</span>
                  <FileWarning size={11} className="text-gold-dark" />
                </div>
              </td>
              <td className="px-5 py-3.5 text-[11px] text-ink-muted max-w-[280px]">{a.primaryViolation}</td>
              <td className="px-5 py-3.5">
                <Pill
                  tone={a.addressStatus === 'YES' ? 'green' : a.addressStatus === 'CONFIRM' ? 'gold' : 'red'}
                >
                  {a.addressStatus}
                </Pill>
              </td>
              <td className="px-5 py-3.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerateLetter(a);
                  }}
                  className="text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-sm flex items-center gap-1 bg-navy text-white hover:bg-navy-dark transition-colors"
                >
                  <Mail size={10} /> Letter
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountDetail({ account, onClose, onGenerateLetter, existingLetters = new Set() }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-white rounded max-w-3xl w-full max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="ccc-display text-xl text-ink font-medium">{account.furnisher}</h2>
            <div className="flex items-center gap-2 mt-1">
              <TypeBadge type={account.type} />
              <span className="text-[11px] text-ink-muted">
                {account.status} · ${account.balance?.toLocaleString() || 0}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <ChevronRight size={16} className="text-ink-muted rotate-90" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {account.originalCreditor && (
            <div className="text-[12px]">
              <span className="text-ink-faint uppercase tracking-wider text-[10px]">Original Creditor: </span>
              <span className="text-ink">{account.originalCreditor}</span>
            </div>
          )}

          <div>
            <h3 className="ccc-display text-[14px] text-ink font-medium mb-3">
              Violations ({account.violations?.length || 0})
            </h3>
            <div className="space-y-3">
              {account.violations?.map((v, i) => (
                <div key={i} className="border border-border rounded p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="ccc-mono text-[11px] text-navy font-medium">{v.field}</div>
                    <SeverityBar severity={v.severity} />
                  </div>
                  <div className="text-[12px] text-ink mt-1">{v.issue}</div>
                  <div className="text-[11px] mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-ink-faint">Currently</div>
                      <div className="text-ink-muted ccc-mono">{v.currentlyReports}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-ink-faint">Should Be</div>
                      <div className="text-green-700 ccc-mono">{v.shouldReport}</div>
                    </div>
                  </div>
                  <div className="ccc-mono text-[10px] text-gold-dark mt-2 pt-2 border-t border-gray-100">
                    {v.statute}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-navy-dark text-white rounded p-4 text-[12px]">
            <div className="text-[10px] uppercase tracking-wider text-gold mb-1">Dispute Strategy</div>
            <div>{account.strategy}</div>
          </div>

          <button
            onClick={() => {
              onGenerateLetter(account);
              onClose();
            }}
            className="w-full px-4 py-3 text-[12px] uppercase tracking-wider rounded-sm font-medium flex items-center justify-center gap-2 bg-gold text-navy-dark hover:bg-gold-dark hover:text-white transition-colors"
          >
            {[...existingLetters].some((lf) => { const af = (account.furnisher || '').toLowerCase().trim(); return lf.includes(af) || af.includes(lf) || lf.split('/').map(s=>s.trim()).some(p => af.includes(p) || p.includes(af)); }) ? <><CheckCircle size={14} className="text-green-600" /> Letter Generated</> : <><Sparkles size={14} /> Generate Phase 1 Letter</>}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
