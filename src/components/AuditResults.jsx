import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { generatePersonalInfoCleanupLetter, generateInquiryRemovalLetter } from '../utils/api';
import {
  CheckCircle2, CheckCircle, Download, ArrowRight, Sparkles, MapPin, Calendar,
  FileWarning, AlertTriangle, Eye, ChevronRight, Mail, Scale, MoreHorizontal, Pencil,
} from 'lucide-react';

// Brand tokens — matches the dashboard / clients card system
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

function Menu({ items }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen(!open)} title="More actions"
        className="flex items-center justify-center rounded-lg border bg-white transition-colors hover:border-navy"
        style={{ width: 30, height: 30, borderColor: T.border, color: T.muted, background: open ? '#EEF1F7' : '#fff' }}>
        <MoreHorizontal size={15} strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 bg-white py-1"
            style={{ top: 34, minWidth: 200, border: '1px solid ' + T.border, borderRadius: 10, boxShadow: '0 8px 24px rgba(16,24,40,0.14)' }}>
            {items.filter(Boolean).map((item, i) => item === 'divider' ? (
              <div key={i} style={{ height: 1, background: T.grid, margin: '4px 0' }} />
            ) : (
              <button key={i}
                onClick={() => { setOpen(false); item.onClick(); }}
                disabled={item.disabled}
                className="w-full text-left px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40 hover:bg-gray-50"
                style={{ color: T.ink }}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

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

async function emailAuditToClient(audit) {
  const clientName = (audit.client && audit.client.name) || '';
  if (!clientName) { alert('No client name in audit'); return; }

  // Look up client email — check client_profiles first, fall back to clients table
  const { supabase } = await import('../utils/supabase');
  const { data: cp } = await supabase.from('client_profiles').select('email,full_name').eq('full_name', clientName).limit(1);
  let clientEmail = cp && cp.length > 0 ? cp[0].email : null;
  if (!clientEmail) {
    const { data: cm } = await supabase.from('clients').select('email').eq('name', clientName).limit(1);
    clientEmail = cm && cm.length > 0 ? cm[0].email : null;
  }

  if (!clientEmail) {
    alert('No email on file for ' + clientName + '. Add their email in the client card first.');
    return;
  }
  if (confirm('Send audit summary to ' + clientEmail + '?')) {
    await sendAuditEmail(audit, clientName, clientEmail);
  }
}

async function sendAuditEmail(audit, clientName, clientEmail) {
  const batch1 = (audit.accounts || []).filter(function(a) { return a.batch === 1; });
  try {
    const res = await fetch('/.netlify/functions/send-lpoa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_audit',
        clientName: clientName,
        clientEmail: clientEmail,
        auditSummary: audit.executiveSummary || '',
        scores: audit.scores || {},
        accountsTargeted: audit.accountsTargeted || (audit.accounts && audit.accounts.length) || 0,
        totalViolations: audit.totalViolations || 0,
        batch1: batch1.map(function(a) { return { furnisher: a.furnisher, accountClassification: a.accountClassification, primaryViolation: a.primaryViolation }; }),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Send failed');
    alert('Audit summary sent to ' + clientEmail);
  } catch (e) {
    alert('Could not send: ' + e.message);
  }
}

function generateAuditPDF(audit) {
  var clientName = (audit.client && audit.client.name) || 'Client';
  var today = new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'});
  var rows = (audit.accounts || []).map(function(a) {
    var cells = [a.furnisher || '', a.accountNumberMasked || a.accountNumber || '-', a.accountClassification || '-', a.status || '-', a.balance ? a.balance.toLocaleString() : '-', String((a.violations && a.violations.length) || 0), 'Batch ' + String(a.batch || 2)];
    return '<tr>' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  }).join('');
  var vrows = (audit.accounts || []).flatMap(function(a) {
    return (a.violations || []).map(function(v) {
      var cells = [a.furnisher, v.field || '-', v.currentlyReports || v.currentValue || '-', v.shouldReport || v.expectedValue || '-', v.statute || v.reason || '-'];
      return '<tr>' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    });
  }).join('');
  var eq = String((audit.scores && audit.scores.equifax) || '-');
  var ex = String((audit.scores && audit.scores.experian) || '-');
  var tu = String((audit.scores && audit.scores.transunion) || '-');
  var css = 'body{font-family:Arial,sans-serif;font-size:12px;margin:0}@page{size:letter;margin:.75in}.h{background:#1B2A4A;color:#C9A84C;padding:20px 32px}.s{padding:16px 32px;border-bottom:1px solid #eee}h2{font-size:12px;text-transform:uppercase;color:#1B2A4A;margin:0 0 8px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#1B2A4A;color:#fff;padding:6px;text-align:left}td{padding:5px;border-bottom:1px solid #f0f0f0}';
  var parts = ['<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Audit - ', clientName, '</title><style>', css, '</style></head><body>', '<div class="h"><h1 style="margin:0;font-size:18px">Credit Comeback Club Forensic Audit</h1><p style="margin:4px 0 0;font-size:11px;color:#fff">Prepared: ', today, '</p></div>', '<div class="s"><h2>Client Information</h2><p><strong>', clientName, '</strong></p><p>', (audit.client && audit.client.address) || '', '</p><p>Accounts Targeted: ', String(audit.accountsTargeted || 0), ' | Total Violations: ', String(audit.totalViolations || 0), '</p></div>', '<div class="s"><h2>Credit Scores</h2><p>Equifax: <strong>', eq, '</strong> &nbsp; Experian: <strong>', ex, '</strong> &nbsp; TransUnion: <strong>', tu, '</strong></p></div>', audit.executiveSummary ? '<div class="s"><h2>Executive Summary</h2><p>' + audit.executiveSummary + '</p></div>' : '',
    '<div class="s" style="background:#f8fbff"><h2 style="color:#1B2A4A">Your Dispute Battle Plan</h2><p style="font-size:11px;color:#555;margin-bottom:16px">Here is exactly what Credit Comeback Club is going to do on your behalf, in plain English. Every action is backed by federal law and sent via certified mail with tracking.</p>' +
    (audit.accounts || []).map(function(a) {
      var typeLabel = a.type === 'C' ? ' <span style="background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700">COLLECTOR</span>' : '';
      var plan = a.type === 'C'
        ? 'We are hitting <strong>' + a.furnisher + '</strong> with two certified letters at the same time — one demanding they prove you owe this debt and that they have the legal right to collect it (federal debt collection law gives them 30 days), and one disputing the inaccurate reporting directly. If they cannot validate the debt, they are legally required to stop reporting it. If they ignore us or respond inadequately, we escalate to all three credit bureaus with their failure as evidence against them.'
        : 'We are sending a certified letter directly to <strong>' + a.furnisher + '</strong> demanding they fix or remove the inaccurate information on your credit report. Specifically: ' + (a.primaryViolation ? a.primaryViolation : 'the violations identified in this report') + '. They have 30 days to respond with original source documentation. If they cannot back up what they are reporting, they must correct or delete it. If they ignore us or send a weak response, we take that to the credit bureaus as proof they cannot defend their own reporting.';
      var topViolations = (a.violations || []).slice(0, 2).map(function(v) {
        return '<li style="margin:3px 0;color:#374151">' + v.issue + '</li>';
      }).join('');
      return '<div style="border:1px solid #dde8f0;border-radius:6px;padding:14px;margin-bottom:12px;background:#fff">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
        '<span style="font-weight:700;font-size:12px;color:#1B2A4A">' + a.furnisher + '</span>' + typeLabel +
        '<span style="margin-left:auto;font-size:10px;color:#6B7280">Batch ' + (a.batch || 2) + ' · ' + (a.violations ? a.violations.length : 0) + ' violations</span>' +
        '</div>' +
        '<p style="font-size:11px;color:#374151;line-height:1.6;margin:0 0 8px">' + plan + '</p>' +
        (topViolations ? '<div style="font-size:10px;color:#6B7280;margin-top:6px"><strong>Key issues found:</strong><ul style="margin:4px 0 0 16px;padding:0">' + topViolations + '</ul></div>' : '') +
        (function() {
          var batchWeek = (a.batch === 1) ? 1 : 3;
          var isTypeC = a.type === 'C';
          var steps = [];
          if (isTypeC) {
            steps = [
              ['Week ' + batchWeek, 'Two certified letters mailed simultaneously — debt validation demand + furnisher dispute'],
              ['Day ' + (batchWeek * 7 + 3) + '-' + (batchWeek * 7 + 5), 'USPS delivery confirmed, 30-day response clock starts'],
              ['Day ' + (batchWeek * 7 + 30), 'Debt validation + dispute response deadline'],
              ['Day ' + (batchWeek * 7 + 36) + '-' + (batchWeek * 7 + 40), 'CCC reviews response — Phase 2 analysis'],
              ['Week ' + (batchWeek + 6), 'Phase 3 escalation mailed to Equifax'],
              ['Week ' + (batchWeek + 8), 'Phase 3 escalation mailed to Experian'],
              ['Week ' + (batchWeek + 10), 'Phase 3 escalation mailed to TransUnion'],
              ['Day 90–120', 'Bureau investigation windows close → deletion, correction, or further escalation'],
            ];
          } else {
            steps = [
              ['Week ' + batchWeek, 'Phase 1 certified letter mailed directly to ' + a.furnisher],
              ['Day ' + (batchWeek * 7 + 3) + '-' + (batchWeek * 7 + 5), 'USPS delivery confirmed, 30-day response clock starts'],
              ['Day ' + (batchWeek * 7 + 30), 'Furnisher response deadline under FCRA §1681s-2(b)'],
              ['Day ' + (batchWeek * 7 + 36) + '-' + (batchWeek * 7 + 40), 'CCC reviews response — Phase 2 analysis'],
              ['Week ' + (batchWeek + 6), 'Phase 3 escalation mailed to Equifax'],
              ['Week ' + (batchWeek + 8), 'Phase 3 escalation mailed to Experian'],
              ['Week ' + (batchWeek + 10), 'Phase 3 escalation mailed to TransUnion'],
              ['Day 90–120', 'Bureau investigation windows close → deletion, correction, or further escalation'],
            ];
          }
          var rows = steps.map(function(s, i) {
            var bg = i % 2 === 0 ? '#F8FAFC' : '#fff';
            var isLast = i === steps.length - 1;
            return '<tr style="background:' + bg + '">' +
              '<td style="padding:5px 8px;font-size:10px;font-weight:700;color:#1B2A4A;white-space:nowrap;border-bottom:1px solid #E5E7EB;width:90px">' + s[0] + '</td>' +
              '<td style="padding:5px 8px;font-size:10px;color:#374151;border-bottom:1px solid #E5E7EB">' + s[1] + '</td>' +
              '</tr>';
          }).join('');
          return '<div style="margin-top:12px;border:1px solid #DBEAFE;border-radius:5px;overflow:hidden">' +
            '<div style="background:#1B2A4A;padding:5px 10px;font-size:10px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:0.06em">Projected Process Timeline</div>' +
            '<table style="width:100%;border-collapse:collapse">' + rows + '</table>' +
            '<div style="padding:5px 10px;font-size:9px;color:#9CA3AF;background:#F9FAFB;border-top:1px solid #E5E7EB">Timeline reflects typical dispute process windows under FCRA. Actual dates depend on mailing date and furnisher response. Results vary — no specific outcome is guaranteed.</div>' +
            '</div>';
        })() +
        '</div>';
    }).join('') +
    '</div>', '<div class="s"><h2>Accounts Targeted</h2><table><thead><tr><th>Furnisher</th><th>Acct</th><th>Type</th><th>Status</th><th>Balance</th><th>Viol</th><th>Batch</th></tr></thead><tbody>', rows, '</tbody></table></div>', /* Violation detail table removed from client PDF — forensic detail kept in admin view only */ '<div style="padding:12px 32px;font-size:10px;color:#999">Credit Comeback Club | 3088 Colorado Ave, Grand Junction, CO 81504 | 970-644-0063</div></body></html>'];
  var html = parts.join('');
  var blob = new Blob([html], {type: 'text/html'});
  var url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
}

export default function AuditResults({ audit, onGenerateLetter, onReset, onBackToClients }) {
  const [existingLetters, setExistingLetters] = React.useState(new Set());
  const [piCleanupStatus, setPiCleanupStatus] = React.useState(null); // null | 'running' | 'done' | error string
  const [inquiryRemovalStatus, setInquiryRemovalStatus] = React.useState(null);
  const [selectedInquiryKeys, setSelectedInquiryKeys] = React.useState(new Set());
  const inqKey = (i) => i.furnisher + '|' + i.date;

  React.useEffect(() => {
    const eligible = (audit.inquiries || []).filter((i) => i.category !== 'linked_to_open_account');
    setSelectedInquiryKeys(new Set(eligible.map(inqKey)));
  }, [audit.inquiries]);

  const BUREAUS = ['Equifax', 'Experian', 'TransUnion'];

  const runPersonalInfoCleanup = async () => {
    setPiCleanupStatus('running');
    try {
      const personalInfo = audit.personalInfo || {};
      const hasAnything = (personalInfo.formerAddresses || []).length > 0
        || (personalInfo.nameVariants || []).length > 0
        || (personalInfo.formerEmployers || []).length > 0;
      if (!hasAnything) throw new Error('No stale personal information found on this audit.');
      for (const bureau of BUREAUS) {
        await generatePersonalInfoCleanupLetter({ ...audit.client, personalInfo, bureau });
      }
      setPiCleanupStatus('done');
    } catch (e) {
      setPiCleanupStatus(e.message || 'Failed');
    }
  };

  const runInquiryRemoval = async () => {
    setInquiryRemovalStatus('running');
    try {
      const allInquiries = audit.inquiries || [];
      let anySent = false;
      for (const bureau of BUREAUS) {
        const bureauCode = bureau === 'Equifax' ? 'EQ' : bureau === 'Experian' ? 'EXP' : 'TU';
        const eligible = allInquiries.filter((i) =>
          (i.bureaus || []).includes(bureauCode) && i.category !== 'linked_to_open_account' && selectedInquiryKeys.has(inqKey(i))
        );
        if (eligible.length === 0) continue;
        await generateInquiryRemovalLetter({ ...audit.client, bureau }, eligible);
        anySent = true;
      }
      if (!anySent) throw new Error('No eligible inquiries found — all are linked to open accounts or none exist.');
      setInquiryRemovalStatus('done');
    } catch (e) {
      setInquiryRemovalStatus(e.message || 'Failed');
    }
  };

  React.useEffect(() => {
    const clientName = audit && audit.client && audit.client.name;
    if (!clientName) return;
    supabase.from('letters').select('account_id').eq('client_name', clientName)
      .then(({ data }) => {
        if (data) setExistingLetters(new Set(data.map((l) => l.account_id).filter(Boolean)));
      });
  }, [audit && audit.client && audit.client.name]);
  const [selectedAccount, setSelectedAccount] = useState(null);

  // Session-local editable copy — auditors can correct extraction errors
  // (balance, status, account number) before any letter is generated
  const [accounts, setAccounts] = useState(audit.accounts || []);
  useEffect(() => { setAccounts(audit.accounts || []); }, [audit]);
  const auditView = { ...audit, accounts };
  const updateAccount = (id, patch) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch, _edited: true } : a)));
    setSelectedAccount((s) => (s && s.id === id ? { ...s, ...patch, _edited: true } : s));
  };

  const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const batch1 = accounts.filter((a) => a.batch === 1);
  const batch2 = accounts.filter((a) => a.batch === 2);

  const genStatus = (status, label) => {
    if (!status) return null;
    if (status === 'running') return <span style={{ color: T.muted }}>Generating {label}…</span>;
    if (status === 'done') return <span className="text-green-700">✓ {label} generated</span>;
    return <span className="text-red-600">{label}: {status}</span>;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4" style={{ padding: '20px 0 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span style={{ width: 4, height: 30, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
          <div>
            <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>Audit Results</h1>
            <p className="text-[11px]" style={{ color: T.muted }}>
              {audit.client?.name || 'Unknown Client'} · Phase 1 strategy ready for review
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onBackToClients && (
            <button
              onClick={onBackToClients}
              className="px-3 py-1.5 text-[11px] uppercase tracking-wider rounded-lg border bg-white transition-colors hover:border-navy"
              style={{ borderColor: T.border, color: T.muted }}>
              ← Clients
            </button>
          )}
          <button
            onClick={function() { generateAuditPDF(auditView); }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] uppercase tracking-wider rounded-lg transition-colors"
            style={{ backgroundColor: T.navy, color: T.gold }}>
            <Download size={13} strokeWidth={1.75} /> Download PDF
          </button>
          <Menu items={[
            { label: 'Email summary to client', onClick: () => emailAuditToClient(auditView) },
            'divider',
            { label: piCleanupStatus === 'done' ? '✓ Personal Info Cleanup generated' : 'Generate Personal Info Cleanup', onClick: runPersonalInfoCleanup, disabled: piCleanupStatus === 'running' },
            { label: inquiryRemovalStatus === 'done' ? '✓ Inquiry Removal generated' : 'Generate Inquiry Removal', onClick: runInquiryRemoval, disabled: inquiryRemovalStatus === 'running' },
            'divider',
            { label: 'New audit', onClick: onReset },
          ]} />
        </div>
      </div>

      {/* Success banner + background-generation status */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12 }}>
        <CheckCircle2 size={18} className="text-green-700 shrink-0" />
        <div className="text-[12px]" style={{ color: T.ink }}>
          <span className="font-medium">Forensic audit complete</span>
          <span style={{ color: T.muted }}> — {audit.accountsTargeted} accounts targeted · {audit.totalViolations} violations identified</span>
        </div>
        <div className="ml-auto text-[11px] flex items-center gap-3">
          {genStatus(piCleanupStatus, 'Personal Info Cleanup')}
          {genStatus(inquiryRemovalStatus, 'Inquiry Removal')}
        </div>
      </div>

      {/* Client info */}
      <div style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 14, padding: 24, boxShadow: T.cardShadow }}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="ccc-display text-2xl text-ink font-medium">
              {audit.client?.name || 'Unknown Client'}
            </h2>
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

        {/* Score + summary tiles */}
        <div className="grid grid-cols-6 gap-3">
          {[
            { label: 'Equifax', val: audit.scores?.equifax ?? '—' },
            { label: 'Experian', val: audit.scores?.experian ?? '—' },
            { label: 'TransUnion', val: audit.scores?.transunion ?? '—' },
            { label: 'Accounts', val: audit.accountsTargeted },
            { label: 'Violations', val: audit.totalViolations, gold: true },
            { label: 'Total Balance', val: '$' + totalBalance.toLocaleString() },
          ].map((s) => (
            <div key={s.label} style={{ background: '#FAFBFC', border: '1px solid #EBEEF3', borderRadius: 10, padding: '10px 12px' }}>
              <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: T.faint }}>{s.label}</div>
              <div className="mt-1" style={{ fontSize: 20, fontWeight: 650, lineHeight: 1.1, color: s.gold ? '#8F7524' : T.ink }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Executive summary */}
      {audit.executiveSummary && (
        <div className="bg-navy-dark text-white p-5" style={{ borderRadius: 14 }}>
          <div className="flex items-center gap-2 mb-2">
            <Scale size={14} className="text-gold" strokeWidth={1.75} />
            <h3 className="ccc-display text-sm font-medium">Executive Summary</h3>
          </div>
          <p className="text-[13px] text-gray-300 leading-relaxed">{audit.executiveSummary}</p>
        </div>
      )}

      {/* Inquiries & Personal Information — review before generating */}
      {((audit.inquiries || []).length > 0 || (audit.personalInfo && (
        (audit.personalInfo.formerAddresses || []).length > 0 ||
        (audit.personalInfo.nameVariants || []).length > 1 ||
        (audit.personalInfo.formerEmployers || []).length > 0
      ))) && (
        <div style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 14, padding: 24, boxShadow: T.cardShadow }}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
            <h3 className="ccc-display text-sm font-medium text-ink">Inquiries &amp; Personal Information</h3>
          </div>
          <p className="text-[12px] text-ink-muted mb-4">Review before using the buttons above. A "no linked account" tag means no matching tradeline was found — it does NOT by itself mean the inquiry was unauthorized. Confirm with the client before disputing.</p>

          {(audit.inquiries || []).length > 0 && (
            <div className="mb-5">
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Hard Inquiries ({audit.inquiries.length})</div>
              <div className="space-y-1.5">
                {audit.inquiries.map((inq, i) => {
                  const cfg = {
                    no_linked_account: { label: 'No linked account', bg: '#FFFBEB', color: '#B45309' },
                    linked_to_open_account: { label: 'Linked — do not dispute', bg: '#F0FDF4', color: '#15803D' },
                    duplicate: { label: 'Duplicate', bg: '#EFF6FF', color: '#1D4ED8' },
                    stale: { label: 'Stale (' + inq.ageInMonths + 'mo)', bg: '#FEF2F2', color: '#B91C1C' },
                  }[inq.category] || { label: inq.category, bg: '#F9FAFB', color: '#6B7280' };
                  const key = inqKey(inq);
                  const disputable = inq.category !== 'linked_to_open_account';
                  const checked = selectedInquiryKeys.has(key);
                  return (
                    <div key={i} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-b-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {disputable ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedInquiryKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                return next;
                              });
                            }}
                            className="shrink-0"
                          />
                        ) : (
                          <span className="w-[13px] shrink-0" />
                        )}
                        <div className="text-[12px] text-ink">
                          <span className="font-medium">{inq.furnisher}</span>
                          <span className="text-ink-muted"> · {inq.date} · {(inq.bureaus || []).join('/')}</span>
                        </div>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm font-medium shrink-0" style={{ background: cfg.bg, color: cfg.color }}>
                        {cfg.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {audit.personalInfo && (
            <div className="grid grid-cols-3 gap-4">
              {(audit.personalInfo.formerAddresses || []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1.5">Former Addresses</div>
                  <ul className="text-[12px] text-ink-muted space-y-1">
                    {audit.personalInfo.formerAddresses.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {(audit.personalInfo.nameVariants || []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1.5">Name Variants</div>
                  <ul className="text-[12px] text-ink-muted space-y-1">
                    {audit.personalInfo.nameVariants.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </div>
              )}
              {(audit.personalInfo.formerEmployers || []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1.5">Former Employers</div>
                  <ul className="text-[12px] text-ink-muted space-y-1">
                    {audit.personalInfo.formerEmployers.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Round 1 Batch 1 */}
      <AccountTable
        title="Round 1 — Batch 1"
        subtitle="Top accounts by balance × violation strength · Send now"
        accounts={batch1}
        onSelect={(a) => setSelectedAccount({ ...a, _clientName: audit.client?.name })}
        onGenerateLetter={onGenerateLetter} existingLetters={existingLetters}
        emphasis
      />

      {/* Round 1 Batch 2 */}
      {batch2.length > 0 && (
        <AccountTable
          title="Round 1 — Batch 2"
          subtitle="Staggered for postage cost control · Send next"
          accounts={batch2}
          onSelect={(a) => setSelectedAccount({ ...a, _clientName: audit.client?.name })}
          onGenerateLetter={onGenerateLetter} existingLetters={existingLetters}
        />
      )}

      {/* Violations by type */}
      {audit.violationsByType?.length > 0 && (
        <div className="bg-white overflow-hidden" style={{ border: '1px solid ' + T.border, borderRadius: 14, boxShadow: T.cardShadow }}>
          <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ borderBottom: '1px solid ' + T.grid }}>
            <span style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
            <h2 className="ccc-display text-[15px] text-ink font-medium">Violations by Type</h2>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: '#FAFBFC', borderBottom: '1px solid ' + T.grid }}>
                <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: T.faint }}>
                  Violation Type
                </th>
                <th className="text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: T.faint }}>
                  Statute
                </th>
                <th className="text-right px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium" style={{ color: T.faint }}>
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
          onUpdateAccount={updateAccount}
        />
      )}
    </div>
  );
}

function AccountTable({ title, subtitle, accounts, onSelect, onGenerateLetter, emphasis, existingLetters = new Set() }) {
  return (
    <div className="bg-white overflow-hidden" style={{ border: '1px solid ' + T.border, borderRadius: 14, boxShadow: T.cardShadow }}>
      <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ borderBottom: '1px solid ' + T.grid }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
        <div>
          <h2 className="ccc-display text-[15px] font-medium text-ink">{title}</h2>
          <p className="text-[11px] mt-0.5 text-ink-muted">{subtitle}</p>
        </div>
        {emphasis && (
          <span className="ml-auto text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full font-semibold"
            style={{ background: T.navy, color: T.gold }}>
            Send Now
          </span>
        )}
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr style={{ background: '#FAFBFC', borderBottom: '1px solid ' + T.grid }}>
            {['Furnisher', 'Type', 'Status', 'Balance', 'Violations', 'Primary Hook', 'Address', ''].map(
              (h) => (
                <th
                  key={h}
                  className="text-left px-5 py-2.5 text-[10px] uppercase tracking-[0.12em] font-medium"
                  style={{ color: T.faint }}
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
                <div className="font-medium text-ink flex items-center gap-1.5">
                  {a.furnisher}
                  {a._edited && <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm" style={{ background: '#FAF3DF', color: '#8F7524' }} title="Fields corrected by auditor">edited</span>}
                </div>
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
                    if (existingLetters.has(a.id) || a.addressStatus !== 'YES') return;
                    onGenerateLetter(a);
                  }}
                  disabled={!existingLetters.has(a.id) && a.addressStatus !== 'YES'}
                  title={a.addressStatus !== 'YES' && !existingLetters.has(a.id) ? 'Furnisher address must be confirmed before a letter can be generated' : undefined}
                  className={`text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-sm flex items-center gap-1 transition-colors ${existingLetters.has(a.id) ? 'bg-green-600 text-white cursor-default' : a.addressStatus !== 'YES' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-navy text-white hover:bg-navy-dark'}`}
                >
                  {existingLetters.has(a.id) ? <><CheckCircle size={10} /> Done</> : a.addressStatus !== 'YES' ? <><Mail size={10} /> Confirm Address</> : <><Mail size={10} /> Letter</>}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FurnisherAddressInput({ account, onSaved }) {
  const [addr, setAddr] = React.useState(account.furnisherAddress || { name: account.furnisher, line1: '', city: '', state: '', zip: '' });
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const handleSave = async () => {
    if (!addr.line1 || !addr.city || !addr.state || !addr.zip) return;
    setSaving(true);
    try {
      // Save to audit jsonb
      const { supabase } = await import('../utils/supabase.js');
      const { data: audits } = await supabase.from('audits').select('id, audit').eq('client_name', account._clientName || '').order('saved_at', { ascending: false }).limit(1);
      if (audits && audits.length > 0) {
        const auditData = audits[0].audit;
        const accounts = auditData.accounts || [];
        const idx = accounts.findIndex(a => a.id === account.id);
        if (idx >= 0) {
          accounts[idx].furnisherAddress = addr;
          accounts[idx].addressStatus = 'YES';
          await supabase.from('audits').update({ audit: auditData }).eq('id', audits[0].id);
        }
      }
      onSaved(addr);
      setSaved(true);
    } catch(e) { console.error('Could not save address:', e); }
    setSaving(false);
  };

  return (
    <div style={{ border: '1px solid #FDE68A', borderRadius: 8, padding: 16, background: '#FFFBEB' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#D97706', fontWeight: 600, marginBottom: 10 }}>
        {account.addressStatus === 'PENDING' ? '⚠ Furnisher Address Required' : '✓ Confirm Furnisher Address'}
      </div>
      {saved ? (
        <div style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>✓ Address saved</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { key: 'name', label: 'Name', full: true },
            { key: 'line1', label: 'Street / PO Box', full: true },
            { key: 'city', label: 'City' },
            { key: 'state', label: 'State' },
            { key: 'zip', label: 'ZIP' },
          ].map(({ key, label, full }) => (
            <div key={key} style={{ gridColumn: full ? 'span 2' : 'span 1' }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
              <input type="text" value={addr[key] || ''} onChange={e => setAddr(p => ({ ...p, [key]: e.target.value }))}
                style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: 4, padding: '6px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ))}
          <div style={{ gridColumn: 'span 2', marginTop: 4 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ fontSize: 11, padding: '6px 16px', background: '#1B2A4A', color: '#C9A84C', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save Address'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountDetail({ account, onClose, onGenerateLetter, existingLetters = new Set(), onUpdateAccount }) {
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({
    balance: account.balance ?? 0,
    status: account.status || '',
    accountNumberMasked: account.accountNumberMasked || '',
    originalCreditor: account.originalCreditor || '',
  });

  const startEdit = () => {
    setForm({
      balance: account.balance ?? 0,
      status: account.status || '',
      accountNumberMasked: account.accountNumberMasked || '',
      originalCreditor: account.originalCreditor || '',
    });
    setEditing(true);
  };

  const saveEdit = () => {
    onUpdateAccount && onUpdateAccount(account.id, {
      balance: parseFloat(form.balance) || 0,
      status: form.status.trim() || account.status,
      accountNumberMasked: form.accountNumberMasked.trim() || account.accountNumberMasked,
      originalCreditor: form.originalCreditor.trim() || null,
    });
    setEditing(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-white max-w-3xl w-full max-h-[85vh] overflow-auto"
        style={{ borderRadius: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="ccc-display text-xl text-ink font-medium flex items-center gap-2">
              {account.furnisher}
              {account._edited && <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm" style={{ background: '#FAF3DF', color: '#8F7524' }}>edited</span>}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <TypeBadge type={account.type} />
              <span className="text-[11px] text-ink-muted">
                {account.status} · ${account.balance?.toLocaleString() || 0}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onUpdateAccount && !editing && (
              <button onClick={startEdit} title="Correct extracted fields before generating letters"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider rounded-lg border transition-colors hover:border-navy"
                style={{ borderColor: T.border, color: T.muted }}>
                <Pencil size={11} strokeWidth={2} /> Edit Details
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
              <ChevronRight size={16} className="text-ink-muted rotate-90" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {editing && (
            <div style={{ border: '1px solid ' + T.border, borderRadius: 10, padding: 16, background: '#FAFBFC' }}>
              <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: T.muted }}>
                Correct extracted fields — letters and exports use your values
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'balance', label: 'Balance ($)', type: 'number' },
                  { key: 'status', label: 'Status' },
                  { key: 'accountNumberMasked', label: 'Account # (masked)' },
                  { key: 'originalCreditor', label: 'Original creditor (Type C)' },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <div className="text-[10px] mb-1" style={{ color: T.faint }}>{label}</div>
                    <input type={type || 'text'} value={form[key]}
                      onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                      className="w-full border rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy"
                      style={{ borderColor: T.border }} />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={saveEdit}
                  className="px-3 py-1.5 text-[11px] uppercase tracking-wider rounded-lg"
                  style={{ background: T.navy, color: T.gold }}>
                  Save Corrections
                </button>
                <button onClick={() => setEditing(false)} className="text-[11px] text-ink-muted hover:text-ink">Cancel</button>
                <span className="text-[10px] ml-auto" style={{ color: T.faint }}>Applies to letters generated this session</span>
              </div>
            </div>
          )}

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
                      <div className="text-ink-muted ccc-mono">{v.currentlyReports || v.currentValue || <span className="text-ink-faint italic">See issue above</span>}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider text-ink-faint">Should Be</div>
                      <div className="text-green-700 ccc-mono">{v.shouldReport || v.expectedValue || <span className="text-ink-faint italic">See issue above</span>}</div>
                    </div>
                  </div>
                  <div className="ccc-mono text-[10px] text-gold-dark mt-2 pt-2 border-t border-gray-100">
                    {v.statute}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#15803D', fontWeight: 600, marginBottom: 6 }}>The Game Plan — In Plain English</div>
            <div style={{ fontSize: 12, color: '#1B2A4A', lineHeight: 1.6 }}>
              {account.type === 'C'
                ? <>We're going to hit <strong>{account.furnisher}</strong> with two simultaneous certified letters — one demanding debt validation under federal debt collection law (they have to prove you owe this and that they have the right to collect it), and one disputing the inaccurate reporting directly. If they can't validate the debt within 30 days, they're legally required to stop reporting it. If they don't respond or respond inadequately, we escalate to all three credit bureaus with their silence or weak response as evidence against them.</>
                : <>We're going to send a certified letter directly to <strong>{account.furnisher}</strong> demanding they fix or remove the inaccurate information on your credit report — specifically, {account.primaryViolation ? account.primaryViolation.toLowerCase() : 'the violations identified above'}. They have 30 days to respond with original source documentation. If they can't back up what they're reporting, they have to correct or delete it. If they ignore us or send a weak response, we take that to the credit bureaus as proof they can't defend their reporting.</>
              }
            </div>
          </div>

          <div className="bg-navy-dark text-white rounded p-4 text-[12px]">
            <div className="text-[10px] uppercase tracking-wider text-gold mb-1">Dispute Strategy — Technical</div>
            <div>{account.strategy}</div>
          </div>

          {(account.addressStatus === 'PENDING' || account.addressStatus === 'CONFIRM') && (
            <FurnisherAddressInput account={account} onSaved={(addr) => { account.furnisherAddress = addr; account.addressStatus = 'YES'; }} />
          )}

          {(() => {
            const hasLetter = [...existingLetters].some((lf) => { const af = (account.furnisher || '').toLowerCase().trim(); return lf.includes(af) || af.includes(lf) || lf.split('/').map(s=>s.trim()).some(p => af.includes(p) || p.includes(af)); });
            const addressBlocked = !hasLetter && account.addressStatus !== 'YES';
            return (
              <button
                onClick={() => {
                  if (addressBlocked) return;
                  onGenerateLetter(account);
                  onClose();
                }}
                disabled={addressBlocked}
                title={addressBlocked ? 'Furnisher address must be confirmed before a letter can be generated' : undefined}
                className={`w-full px-4 py-3 text-[12px] uppercase tracking-wider rounded-sm font-medium flex items-center justify-center gap-2 transition-colors ${addressBlocked ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gold text-navy-dark hover:bg-gold-dark hover:text-white'}`}
              >
                {hasLetter ? <><CheckCircle size={14} className="text-green-600" /> Letter Generated</> : addressBlocked ? <><Mail size={14} /> Confirm Furnisher Address First</> : <><Sparkles size={14} /> Generate Phase 1 Letter</>}
                <ArrowRight size={12} />
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
