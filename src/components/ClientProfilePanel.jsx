import React, { useState } from 'react';
import { updateClientProfile } from '../utils/storage';
import { ExternalLink, Edit2, Check, X, Plus } from 'lucide-react';

function Field({ label, value, onSave, type = 'text', placeholder = '' }) {
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
          className="flex-1 border border-border rounded-sm px-2 py-1 text-[12px] focus:outline-none focus:border-navy"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
        <button onClick={save} className="text-green-600 hover:text-green-700"><Check size={13} strokeWidth={2} /></button>
        <button onClick={() => setEditing(false)} className="text-ink-faint hover:text-red-600"><X size={13} strokeWidth={2} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <span className="text-[12px] text-ink">{value || <span className="text-ink-faint italic">Not set</span>}</span>
      <button onClick={() => { setVal(value || ''); setEditing(true); }}
        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-navy transition-opacity">
        <Edit2 size={11} strokeWidth={2} />
      </button>
    </div>
  );
}


function PasswordField({ label, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [val, setVal] = useState(value || '');

  const save = async () => {
    await onSave(val);
    setEditing(false);
    setVisible(false);
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
            className="w-full border border-border rounded-sm px-2 py-1 text-[12px] focus:outline-none focus:border-navy pr-7"
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button onClick={() => setVisible(!visible)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-navy text-[10px]">
            {visible ? '○' : '●'}
          </button>
        </div>
        <button onClick={save} className="text-green-600 hover:text-green-700"><Check size={13} strokeWidth={2} /></button>
        <button onClick={() => setEditing(false)} className="text-ink-faint hover:text-red-600"><X size={13} strokeWidth={2} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <span className="text-[12px] text-ink font-mono">
        {value ? (visible ? value : '••••••••') : <span className="text-ink-faint italic">Not set</span>}
      </span>
      {value && (
        <button onClick={() => setVisible(!visible)} className="text-ink-faint hover:text-navy text-[10px]">
          {visible ? '○' : '●'}
        </button>
      )}
      <button onClick={() => { setVal(value || ''); setEditing(true); }}
        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-navy transition-opacity">
        <Edit2 size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

function TextareaField({ label, value, onSave }) {
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
          className="w-full border border-border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy resize-none" />
        <div className="flex gap-2">
          <button onClick={save} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
          <button onClick={() => setEditing(false)} className="text-[11px] text-ink-muted">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="group cursor-pointer" onClick={() => { setVal(value || ''); setEditing(true); }}>
      <span className="text-[12px] text-ink whitespace-pre-wrap">{value || <span className="text-ink-faint italic">Click to add notes…</span>}</span>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-5 gap-2 py-1.5 border-b border-border last:border-b-0">
      <div className="col-span-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium pt-0.5">{label}</div>
      <div className="col-span-3">{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-white font-medium bg-navy px-3 py-1.5 rounded-sm mb-2">{title}</div>
      <div className="px-1">{children}</div>
    </div>
  );
}

export default function ClientProfilePanel({ client, onChanged }) {
  const save = async (fields) => {
    await updateClientProfile(client.name, fields);
    onChanged();
  };

  const latestAudit = client.audits && client.audits.length > 0 
    ? client.audits[client.audits.length - 1] 
    : null;
  const currentScores = latestAudit ? {
    eq: latestAudit.scores?.equifax || latestAudit.scores?.eq || null,
    exp: latestAudit.scores?.experian || latestAudit.scores?.exp || null,
    tu: latestAudit.scores?.transunion || latestAudit.scores?.tu || null,
  } : {};

  return (
    <div className="space-y-0">

      <Section title="Contact Information">
        <Row label="Full Name"><span className="text-[12px] text-ink font-medium">{client.name}</span></Row>
        <Row label="Email">
          <Field value={client.email} placeholder="client@email.com"
            onSave={(v) => save({ email: v })} />
        </Row>
        <Row label="Phone">
          <Field value={client.phone} placeholder="(555) 555-5555"
            onSave={(v) => save({ phone: v })} />
        </Row>
        <Row label="Address">
          <Field value={client.address} placeholder="123 Main St, City, ST 12345"
            onSave={(v) => save({ address: v })} />
        </Row>
        <Row label="Date of Birth">
          <Field value={client.dateOfBirth} placeholder="MM/DD/YYYY"
            onSave={(v) => save({ date_of_birth: v })} />
        </Row>
        <Row label="SSN Last 4">
          <PasswordField value={client.ssnLast4}
            onSave={(v) => save({ ssn_last4: v })} />
        </Row>
      </Section>

      <Section title="Credit Monitoring">
        <Row label="Service">
          <Field value={client.monitoringService} placeholder="Privacy Guard"
            onSave={(v) => save({ monitoring_service: v })} />
        </Row>
        <Row label="Login Email">
          <Field value={client.monitoringEmail} placeholder="client@email.com"
            onSave={(v) => save({ monitoring_email: v })} />
        </Row>
        <Row label="Password">
          <PasswordField value={client.monitoringPassword}
            onSave={(v) => save({ monitoring_password: v })} />
        </Row>
        <Row label="Portal">
          <div className="flex items-center gap-2">
            <a href={client.monitoringPortalUrl || 'https://www.privacyguard.com'}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[12px] text-navy hover:text-gold">
              <ExternalLink size={11} strokeWidth={2} />
              {client.monitoringService || 'Privacy Guard'}
            </a>
          </div>
        </Row>
        <Row label="Enrolled">
          <div className="flex items-center gap-2">
            <button onClick={() => save({ monitoring_enrolled: !client.monitoringEnrolled })}
              className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border transition-colors ' +
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

      <Section title="Credit Scores">
        <Row label="At Enrollment">
          <div className="flex items-center gap-4">
            {[['EQ', 'score_eq_start', client.scoreEqStart], ['EXP', 'score_exp_start', client.scoreExpStart], ['TU', 'score_tu_start', client.scoreTuStart]].map(([label, field, val]) => (
              <div key={label} className="text-center">
                <div className="text-[9px] text-ink-faint uppercase">{label}</div>
                <Field value={val ? String(val) : ''} placeholder="—" type="number"
                  onSave={(v) => save({ [field]: v ? parseInt(v) : null })} />
              </div>
            ))}
          </div>
        </Row>
        <Row label="Current">
          <div className="flex items-center gap-4">
            {[['EQ', currentScores.eq], ['EXP', currentScores.exp], ['TU', currentScores.tu]].map(([label, val]) => (
              <div key={label} className="text-center">
                <div className="text-[9px] text-ink-faint uppercase">{label}</div>
                <span className="text-[12px] font-medium" style={{ color: val ? '#1B2A4A' : '#9CA3AF' }}>{val || '—'}</span>
              </div>
            ))}
          </div>
        </Row>
        {(client.scoreEqStart || client.scoreExpStart || client.scoreTuStart) && (currentScores.eq || currentScores.exp || currentScores.tu) && (
          <Row label="Change">
            <div className="flex items-center gap-4">
              {[['EQ', client.scoreEqStart, currentScores.eq], ['EXP', client.scoreExpStart, currentScores.exp], ['TU', client.scoreTuStart, currentScores.tu]].map(([label, start, current]) => {
                const diff = (current && start) ? current - start : null;
                return (
                  <div key={label} className="text-center">
                    <div className="text-[9px] text-ink-faint uppercase">{label}</div>
                    <span className="text-[12px] font-medium" style={{ color: diff === null ? '#9CA3AF' : diff > 0 ? '#15803D' : diff < 0 ? '#DC2626' : '#666' }}>
                      {diff === null ? '—' : (diff > 0 ? '+' : '') + diff}
                    </span>
                  </div>
                );
              })}
            </div>
          </Row>
        )}
      </Section>

      <Section title="Campaign Info">
        <Row label="Enrolled">
          <Field value={client.enrollmentDate} placeholder="YYYY-MM-DD" type="date"
            onSave={(v) => save({ enrollment_date: v })} />
        </Row>
        <Row label="Referral Source">
          <Field value={client.referralSource} placeholder="e.g. Facebook, referral from John"
            onSave={(v) => save({ referral_source: v })} />
        </Row>
        <Row label="Letters">
          <span className="text-[12px] text-ink">{client.letters ? client.letters.length : 0} total</span>
        </Row>
      </Section>

      <Section title="Notes">
        <TextareaField value={client.notes}
          onSave={(v) => save({ notes: v })} />
      </Section>

      <Section title="Portal Access">
        <OnboardingButton client={client} onChanged={onChanged} />
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

      // Ensure client_profiles row exists BEFORE sending the magic link.
      // Without this, first login fails the client check in App.jsx's loadUser()
      // and the person gets routed to the internal admin shell instead of the client portal.
      const { error: cpError } = await supabase.from('client_profiles').upsert({
        full_name: client.name,
        email: client.email,
        onboarding_complete: false,
      }, { onConflict: 'email' });
      if (cpError) throw cpError;

      const { error } = await supabase.auth.signInWithOtp({
        email: client.email,
        options: { emailRedirectTo: window.location.origin }
      });
      if (error) throw error;

      // Send branded welcome email
      await fetch('/.netlify/functions/send-lpoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_onboarding_welcome',
          clientName: client.name,
          clientEmail: client.email,
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
      {client.onboardingComplete ? (
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2 py-1 rounded-sm bg-green-50 text-green-700 border border-green-200">✓ Portal Active</span>
          <button onClick={handleSend} disabled={sending}
            className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-navy">
            Resend Link
          </button>
        </div>
      ) : (
        <div>
          <button onClick={handleSend} disabled={sending || !client.email}
            className="flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
            style={{ background: sending || !client.email ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C', cursor: !client.email ? 'not-allowed' : 'pointer' }}>
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
