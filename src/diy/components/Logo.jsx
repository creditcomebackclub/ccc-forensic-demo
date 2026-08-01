import { Link } from 'react-router-dom';

/** Fieldwork brand mark — grid field with signal cell. */
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
      <rect width="64" height="64" rx="12" fill="#07131F" />
      <g stroke="#2A4A58" strokeWidth="1.5">
        <path d="M16 22h32M16 32h32M16 42h32M22 16v32M32 16v32M42 16v32" />
      </g>
      <rect x="28" y="28" width="8" height="8" fill="#2EE6A6" />
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
