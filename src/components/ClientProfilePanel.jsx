import React, { useState } from 'react';
import { updateClientProfile } from '../utils/storage';
import { readClientSensitiveData, writeClientSensitiveData } from '../utils/clientSensitiveData';
import { ExternalLink, Edit2, Check, X } from 'lucide-react';

// Brand tokens — matches the dashboard / clients card system
const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
};

function Field({ label, value, onSave, type = 'text', placeholder = '', align = 'left' }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');

  const save = async () => {
    await onSave(val);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type={type}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="flex-1 border rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-navy"
          style={{ borderColor: T.border, minWidth: 60 }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
        <button onClick={save} className="text-green-600 hover:text-green-700"><Check size={13} strokeWidth={2} /></button>
        <button onClick={() => setEditing(false)} className="text-ink-faint hover:text-red-600"><X size={13} strokeWidth={2} /></button>
      </div>
    );
  }

  return (
    <div className={'flex items-center gap-1.5 group ' + (align === 'right' ? 'justify-end' : '')}>
      <span className="text-[12px]" style={{ color: value ? T.ink : T.faint, fontStyle: value ? 'normal' : 'italic' }}>{value || 'Not set'}</span>
      <button onClick={() => { setVal(value || ''); setEditing(true); }}
        title={'Edit ' + (label || 'field')}
        className="opacity-30 group-hover:opacity-100 text-ink-faint hover:text-navy transition-opacity">
        <Edit2 size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

// Encrypted field (SSN last-4 / monitoring password). Unlike Field, the
// plaintext value is never part of the bulk client list — it's fetched and
// decrypted on demand, only when staff explicitly click reveal or edit.
function PasswordField({ clientName, field, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [val, setVal] = useState('');
  const [revealed, setRevealed] = useState(null); // null = not fetched yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fetchValue = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await readClientSensitiveData(clientName);
      const value = (field === 'ssnLast4' ? data.ssnLast4 : data.monitoringPassword) || '';
      setRevealed(value);
      return value;
    } catch (e) {
      setError('Could not load');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleReveal = async () => {
    if (revealed === null) {
      const value = await fetchValue();
      if (value !== null) setVisible(true);
    } else {
      setVisible(!visible);
    }
  };

  const startEdit = async () => {
    let value = revealed;
    if (value === null) {
      value = await fetchValue();
      if (value === null) return;
    }
    setVal(value);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await writeClientSensitiveData(clientName, { [field]: val });
      setRevealed(val);
      setEditing(false);
      setVisible(false);
      onSaved && onSaved();
    } catch (e) {
      setError('Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input
            type={visible ? 'text' : 'password'}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            autoFocus
            className="w-full border rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-navy pr-7"
            style={{ borderColor: T.border }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button onClick={() => setVisible(!visible)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-navy text-[10px]">
            {visible ? '○' : '●'}
          </button>
        </div>
        <button onClick={save} disabled={busy} className="text-green-600 hover:text-green-700"><Check size={13} strokeWidth={2} /></button>
        <button onClick={() => setEditing(false)} className="text-ink-faint hover:text-red-600"><X size={13} strokeWidth={2} /></button>
      </div>
    );
  }

  const displayText = busy ? 'Loading…'
    : revealed === null ? '••••••••'
    : revealed ? (visible ? revealed : '••••••••')
    : 'Not set';

  return (
    <div className="flex items-center gap-1.5 group">
      <span className="text-[12px] font-mono" style={{ color: revealed ? T.ink : T.faint, fontStyle: revealed === '' ? 'italic' : 'normal' }}>
        {displayText}
      </span>
      <button onClick={toggleReveal} disabled={busy} className="text-ink-faint hover:text-navy text-[10px]">
        {revealed !== null && visible ? '○' : '●'}
      </button>
      <button onClick={startEdit}
        title="Edit"
        className="opacity-30 group-hover:opacity-100 text-ink-faint hover:text-navy transition-opacity">
        <Edit2 size={11} strokeWidth={2} />
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

function TextareaField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');

  const save = async () => {
    await onSave(val);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1.5">
        <textarea value={val} onChange={(e) => setVal(e.target.value)} autoFocus rows={3}
          className="w-full border rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy resize-none"
          style={{ borderColor: T.border }} />
        <div className="flex gap-2">
          <button onClick={save} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2.5 py-1 rounded-md">Save</button>
          <button onClick={() => setEditing(false)} className="text-[11px] text-ink-muted">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="group cursor-pointer rounded-md -mx-1 px-1 py-0.5 hover:bg-gray-50 transition-colors"
      onClick={() => { setVal(value || ''); setEditing(true); }}>
      <span className="text-[12px] whitespace-pre-wrap" style={{ color: value ? T.ink : T.faint, fontStyle: value ? 'normal' : 'italic' }}>
        {value || 'Click to add notes…'}
      </span>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-5 gap-2 py-2 border-b last:border-b-0 items-center" style={{ borderColor: T.grid }}>
      <div className="col-span-2 text-[11px]" style={{ color: T.muted }}>{label}</div>
      <div className="col-span-3">{children}</div>
    </div>
  );
}

function Section({ title, children, span2 }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}
      style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 12, padding: '14px 16px' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ width: 3, height: 12, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
        <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: T.muted }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function ScoreTile({ label, current, start, onSaveStart }) {
  const diff = (current && start) ? current - start : null;
  return (
    <div style={{ background: '#FAFBFC', border: '1px solid #EBEEF3', borderRadius: 10, padding: '10px 12px' }}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: T.faint }}>{label}</span>
        {diff !== null && diff !== 0 && (
          <span className="text-[10px] font-bold px-1.5 py-px rounded"
            style={{ color: diff > 0 ? '#15803D' : '#DC2626', background: diff > 0 ? '#F0FDF4' : '#FEF2F2' }}>
            {diff > 0 ? '▲ +' + diff : '▼ ' + diff}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span style={{ fontSize: 22, fontWeight: 650, lineHeight: 1, color: current ? T.ink : T.faint }}>{current || '—'}</span>
        <span className="text-[10px]" style={{ color: T.faint }}>current</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 text-[10px]" style={{ color: T.faint }}>
        <span>started at</span>
        <Field label={label + ' start score'} value={start ? String(start) : ''} placeholder="—" type="number" onSave={onSaveStart} />
      </div>
    </div>
  );
}

export default function ClientProfilePanel({ client, onChanged, onBatchMail }) {
  const save = async (fields) => {
    await updateClientProfile(client.name, fields);
    onChanged();
  };

  const latestAudit = client.audits && client.audits.length > 0
    ? client.audits[client.audits.length - 1]
    : null;
  // Scores live inside the saved audit blob (record.audit.scores)
  const scores = (latestAudit && (latestAudit.audit?.scores || latestAudit.scores)) || {};
  const currentScores = {
    eq: scores.equifax || scores.eq || null,
    exp: scores.experian || scores.exp || null,
    tu: scores.transunion || scores.tu || null,
  };

  return (
    <div className="grid grid-cols-2 gap-3">

      <Section title="Contact">
        <Row label="Full name"><span className="text-[12px] font-medium" style={{ color: T.ink }}>{client.name}</span></Row>
        <Row label="Email">
          <Field label="email" value={client.email} placeholder="client@email.com"
            onSave={(v) => save({ email: v })} />
        </Row>
        <Row label="Phone">
          <Field label="phone" value={client.phone} placeholder="(555) 555-5555"
            onSave={(v) => save({ phone: v })} />
        </Row>
        <Row label="Address">
          <Field label="address" value={client.address} placeholder="123 Main St, City, ST 12345"
            onSave={(v) => save({ address: v })} />
        </Row>
        <Row label="Date of birth">
          <Field label="date of birth" value={client.dateOfBirth} placeholder="MM/DD/YYYY"
            onSave={(v) => save({ date_of_birth: v })} />
        </Row>
        <Row label="SSN last 4">
          <PasswordField clientName={client.name} field="ssnLast4" onSaved={onChanged} />
        </Row>
      </Section>

      <Section title="Credit Monitoring">
        <Row label="Service">
          <Field label="service" value={client.monitoringService} placeholder="Privacy Guard"
            onSave={(v) => save({ monitoring_service: v })} />
        </Row>
        <Row label="Login email">
          <Field label="login email" value={client.monitoringEmail} placeholder="client@email.com"
            onSave={(v) => save({ monitoring_email: v })} />
        </Row>
        <Row label="Password">
          <PasswordField clientName={client.name} field="monitoringPassword" onSaved={onChanged} />
        </Row>
        <Row label="Portal">
          <a href={client.monitoringPortalUrl || 'https://www.privacyguard.com'}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-navy hover:text-gold">
            <ExternalLink size={11} strokeWidth={2} />
            {client.monitoringService || 'Privacy Guard'}
          </a>
        </Row>
        <Row label="Enrolled">
          <div className="flex items-center gap-2">
            <button onClick={() => save({ monitoring_enrolled: !client.monitoringEnrolled })}
              className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ' +
                (client.monitoringEnrolled
                  ? 'bg-green-50 text-green-700 border-green-300'
                  : 'bg-amber-50 text-amber-700 border-amber-300')}>
              {client.monitoringEnrolled ? '✓ Enrolled' : '○ Not enrolled'}
            </button>
            {!client.monitoringEnrolled && (
              <a href={client.monitoringPortalUrl || 'https://www.privacyguard.com'}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-navy hover:text-gold">
                Sign up →
              </a>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Credit Scores" span2>
        <div className="grid grid-cols-3 gap-3 mt-1">
          <ScoreTile label="Equifax" current={currentScores.eq} start={client.scoreEqStart}
            onSaveStart={(v) => save({ score_eq_start: v ? parseInt(v) : null })} />
          <ScoreTile label="Experian" current={currentScores.exp} start={client.scoreExpStart}
            onSaveStart={(v) => save({ score_exp_start: v ? parseInt(v) : null })} />
          <ScoreTile label="TransUnion" current={currentScores.tu} start={client.scoreTuStart}
            onSaveStart={(v) => save({ score_tu_start: v ? parseInt(v) : null })} />
        </div>
        {!latestAudit && (
          <div className="text-[10px] mt-2" style={{ color: T.faint }}>Current scores populate from the latest audit report.</div>
        )}
      </Section>

      <Section title="Campaign">
        <Row label="Enrolled">
          <Field label="enrollment date" value={client.enrollmentDate} placeholder="YYYY-MM-DD" type="date"
            onSave={(v) => save({ enrollment_date: v })} />
        </Row>
        <Row label="Referral source">
          <Field label="referral source" value={client.referralSource} placeholder="e.g. Facebook, referral from John"
            onSave={(v) => save({ referral_source: v })} />
        </Row>
        <Row label="Letters">
          <div className="flex items-center gap-3">
            <span className="text-[12px]" style={{ color: T.ink }}>{client.letters ? client.letters.length : 0} total</span>
            {client.letters && client.letters.filter(l => !l.mailed_date && !l.mailedDate).length > 0 && (
              <button 
                onClick={() => onBatchMail(client.letters.filter(l => !l.mailed_date && !l.mailedDate))}
                className="text-[10px] uppercase tracking-wider text-white bg-navy px-2 py-1 rounded-sm hover:opacity-90"
              >
                Mail {client.letters.filter(l => !l.mailed_date && !l.mailedDate).length} Unmailed
              </button>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Notes">
        <TextareaField value={client.notes}
          onSave={(v) => save({ notes: v })} />
      </Section>

      <Section title="Portal Access" span2>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <OnboardingButton client={client} onChanged={onChanged} />
          <ImpersonateButton client={client} />
        </div>
      </Section>

    </div>
  );
}

function OnboardingButton({ client, onChanged }) {
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const handleSend = async () => {
    if (!client.email) { setErr('Add client email first.'); return; }
    setSending(true);
    setErr(null);
    try {
      const { supabase } = await import('../utils/supabase.js');
      const normEmail = client.email.trim().toLowerCase();

      // Provision the auth user + linked client_profiles row server-side
      // (service role) BEFORE sending the magic link. Without this, first
      // login can find a half-created account and misroute the client.
      const { data: { session: adminSession } } = await supabase.auth.getSession();
      const adminToken = adminSession?.access_token;
      const authHeaders = {
        'Content-Type': 'application/json',
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      };

      const provRes = await fetch('/.netlify/functions/provision-user', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ email: normEmail, fullName: client.name, kind: 'client' }),
      });
      if (!provRes.ok) {
        const out = await provRes.json().catch(() => ({}));
        throw new Error(out.error || 'Could not provision client account');
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: normEmail,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) throw error;

      // Send branded welcome email
      await fetch('/.netlify/functions/send-lpoa', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'send_onboarding_welcome',
          clientName: client.name,
          clientEmail: normEmail,
          magicLink: window.location.origin,
        }),
      });

      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (e) {
      setErr(e.message || 'Could not send magic link');
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {(client.portalOnboarded || client.onboardingComplete) ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">✓ Portal Active</span>
          <button onClick={handleSend} disabled={sending}
            className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-navy">
            Resend Link
          </button>
        </div>
      ) : (
        <div>
          <button onClick={handleSend} disabled={sending || !client.email}
            className="flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-wider rounded-lg transition-colors"
            style={{ background: sending || !client.email ? '#B5BBC9' : T.navy, color: T.gold, cursor: !client.email ? 'not-allowed' : 'pointer' }}>
            {sending ? 'Sending…' : sent ? '✓ Magic Link Sent!' : 'Start Onboarding'}
          </button>
          {!client.email && <div className="text-[11px] text-amber-600 mt-1">Add client email first.</div>}
          {err && <div className="text-[11px] text-red-600 mt-1">{err}</div>}
          {sent && <div className="text-[11px] text-green-600 mt-1">Magic link sent to {client.email}</div>}
        </div>
      )}
    </div>
  );
}

function ImpersonateButton({ client }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const handleImpersonate = async () => {
    if (!client.email) { setErr('No email on file.'); return; }
    setLoading(true);
    setErr(null);
    
    // Open tab synchronously to prevent popup blockers
    const newTab = window.open('about:blank', '_blank');
    
    try {
      const { supabase: sb } = await import('../utils/supabase.js');
      const { data: { session: adminSess } } = await sb.auth.getSession();
      const adminTok = adminSess?.access_token;
      const res = await fetch('/.netlify/functions/admin-impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminTok ? { Authorization: `Bearer ${adminTok}` } : {}),
        },
        body: JSON.stringify({ email: client.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (!data.link) throw new Error('No link returned');
      
      if (newTab) {
        newTab.location.href = data.link;
      } else {
        window.open(data.link, '_blank');
      }
    } catch (e) {
      if (newTab) newTab.close();
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleImpersonate}
        disabled={loading || !client.email}
        className="flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-wider rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
      >
        {loading ? 'Generating…' : '🔑 View as Client'}
      </button>
      {err && <div className="text-[11px] text-red-600 mt-1">{err}</div>}
    </div>
  );
}
