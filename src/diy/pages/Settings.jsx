import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFieldwork } from '../state';
import SignaturePad from '../components/SignaturePad';

export default function Settings() {
  const { user, updateProfile } = useFieldwork();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [line1, setLine1] = useState(user.address.line1);
  const [city, setCity] = useState(user.address.city);
  const [state, setState] = useState(user.address.state);
  const [zip, setZip] = useState(user.address.zip);
  const [signatureData, setSignatureData] = useState(user.signatureData || null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="mx-auto max-w-xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Settings</p>
      <h1 className="fw-display mt-2 text-4xl font-bold">Account</h1>
      <p className="mt-3 text-[var(--fw-muted)]">
        Your identity on letters — return address and drawn signature. Never an agency “c/o”.
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError('');
          setSaved(false);
          try {
            await updateProfile({
              name,
              email,
              address: { line1, city, state, zip },
              signatureData,
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          } catch (err) {
            console.error(err);
            setError(err?.message || 'Could not save profile to Fieldwork.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="block">
          <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Legal name</span>
          <input
            className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Email</span>
          <input
            type="email"
            className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Address line</span>
          <input
            className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">City</span>
            <input
              className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">State</span>
            <input
              className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">ZIP</span>
            <input
              className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
            />
          </label>
        </div>

        <div className="pt-4">
          <div className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">
            Signature for letters
          </div>
          <p className="mt-1 text-sm text-[var(--fw-muted)]">
            Draw once with mouse or finger — saved to your Fieldwork account and embedded on every dispute letter.
          </p>
          <SignaturePad
            className="mt-3"
            value={signatureData}
            onChange={setSignatureData}
          />
          {!signatureData && (
            <p className="mt-2 text-xs text-[#b93d30]">
              No signature yet — letters will show a blank line until you draw one and save.
            </p>
          )}
        </div>

        {error ? (
          <p className="text-sm text-[#b93d30]">{error}</p>
        ) : null}

        <button type="submit" className="fw-btn-ink mt-4" disabled={saving}>
          {saving ? 'Saving…' : saved ? 'Saved to Fieldwork' : 'Save profile'}
        </button>
      </form>

      <p className="mt-8 text-sm text-[var(--fw-muted)]">
        After saving, reopen{' '}
        <Link to="/app/campaign/new" className="font-semibold text-[var(--fw-sea)] hover:underline">
          Compose letters
        </Link>{' '}
        to see the signature on previews.
      </p>
    </div>
  );
}
