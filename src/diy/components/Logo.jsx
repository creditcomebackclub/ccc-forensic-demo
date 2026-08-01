import { Link } from 'react-router-dom';

/** Fieldwork brand mark — target / dispute-at-the-source. */
export function FieldworkMark({ size = 28, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#07131F" />
      <circle cx="32" cy="32" r="18" stroke="#E8EEF2" strokeWidth="2" />
      <circle cx="32" cy="32" r="11" stroke="#E8EEF2" strokeWidth="1.75" />
      <line x1="32" y1="10" x2="32" y2="22" stroke="#E8EEF2" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1="42" x2="32" y2="54" stroke="#E8EEF2" strokeWidth="2" strokeLinecap="round" />
      <line x1="10" y1="32" x2="22" y2="32" stroke="#E8EEF2" strokeWidth="2" strokeLinecap="round" />
      <line x1="42" y1="32" x2="54" y2="32" stroke="#E8EEF2" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4" fill="#2EE6A6" />
    </svg>
  );
}

export default function Logo({
  to = '/',
  invert = false,
  size = 28,
  className = '',
  wordmarkClass = '',
}) {
  const color = invert ? 'text-white' : 'text-[var(--fw-ink)]';
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${color} ${className}`}>
      <FieldworkMark size={size} />
      <span className={`fw-display text-[1.35rem] font-extrabold tracking-tight leading-none ${wordmarkClass}`}>
        Fieldwork<span className="text-[var(--fw-signal)]">.</span>
      </span>
    </span>
  );

  if (to === false) return content;
  return (
    <Link to={to} className="inline-flex no-underline" aria-label="Fieldwork home">
      {content}
    </Link>
  );
}
