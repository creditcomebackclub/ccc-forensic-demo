import { useState } from 'react';
import { useFieldwork } from '../state';

export default function Settings() {
  const { user, updateProfile } = useFieldwork();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [line1, setLine1] = useState(user.address.line1);
  const [city, setCity] = useState(user.address.city);
  const [state, setState] = useState(user.address.state);
  const [zip, setZip] = useState(user.address.zip);
  const [saved, setSaved] = useState(false);

  return (
    <div className="mx-auto max-w-xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Settings</p>
      <h1 className="fw-display mt-2 text-4xl font-bold">Account</h1>
      <p className="mt-3 text-[var(--fw-muted)]">
        Your identity on letters. In production this is the return address Lob uses — never an agency “c/o”.
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          updateProfile({
            name,
            email,
            address: { line1, city, state, zip },
          });
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
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

        <button type="submit" className="fw-btn-ink mt-4">
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </form>
    </div>
  );
}
