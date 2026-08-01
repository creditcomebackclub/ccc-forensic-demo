import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Plus,
  RotateCcw,
  Settings,
  Waypoints,
} from 'lucide-react';
import { useFieldwork } from '../state';
import Logo from '../components/Logo';

const NAV = [
  { to: '/app', end: true, label: 'Home', icon: LayoutDashboard },
  { to: '/app/campaign/new', label: 'New campaign', icon: Plus },
  { to: '/app/campaigns', label: 'Campaigns', icon: Waypoints },
  { to: '/app/documents', label: 'Documents', icon: FolderOpen },
  { to: '/app/billing', label: 'Billing', icon: CreditCard },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export default function AppShell() {
  const { user, plan, mailCredits, auditCredits, signOut, resetAll, startNewCampaign, runtime } = useFieldwork();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[var(--fw-paper)] text-[var(--fw-ink)] md:flex">
      <aside className="flex w-full flex-col border-b border-[var(--fw-line)] bg-[var(--fw-ink)] text-white md:w-60 md:border-b-0 md:border-r md:border-white/10">
        <div className="flex items-center justify-between px-5 py-5">
          <Logo invert to="/" size={26} wordmarkClass="!text-lg" />
          <span className="fw-mono rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/50 md:hidden">
            SaaS demo
          </span>
        </div>

        <div className="mx-5 mb-4 rounded border border-white/10 bg-white/5 px-3 py-3">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-white/40">Plan</div>
          <div className="mt-1 font-semibold">{plan.name}</div>
          <div className="mt-2 flex items-baseline justify-between gap-2 fw-mono text-[11px] text-[var(--fw-signal)]">
            <span>{mailCredits} mail</span>
            <span>{auditCredits} audits</span>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-2.5 rounded px-3 py-2.5 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-white/10 px-4 py-4">
          <div className="truncate text-sm font-medium">{user.name}</div>
          <div className="truncate text-xs text-white/40">{user.email}</div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                signOut();
                navigate('/');
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-white/15 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5"
            >
              <LogOut size={12} /> Sign out
            </button>
            <button
              type="button"
              onClick={() => {
                resetAll();
                navigate('/');
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-white/15 px-2 py-1.5 text-xs text-white/70 hover:bg-white/5"
              title="Reset demo data"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--fw-line)] bg-[rgba(242,245,247,0.92)] px-4 py-3 backdrop-blur md:px-8">
          <div className="fw-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fw-muted)]">
            Fieldwork · {runtime.mode === 'demo' ? 'demo' : runtime.mode}
          </div>
          <button
            type="button"
            onClick={() => {
              startNewCampaign();
              navigate('/app/campaign/new');
            }}
            className="fw-btn-ink !py-2 !px-3 text-xs md:text-sm"
          >
            <Plus size={14} /> New campaign
          </button>
        </header>
        <main className="px-4 py-8 md:px-8 md:py-10">
          <Outlet />
        </main>
        <footer className="border-t border-[var(--fw-line)] px-4 py-6 text-xs text-[var(--fw-muted)] md:px-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5">
              <FileText size={12} />
              Not legal advice. You authorize every letter.
            </span>
            <Link to="/terms" className="hover:text-[var(--fw-ink)]">Terms</Link>
            <Link to="/privacy" className="hover:text-[var(--fw-ink)]">Privacy</Link>
            <Link to="/croa" className="hover:text-[var(--fw-ink)]">CROA rights</Link>
            <Link to="/contact" className="hover:text-[var(--fw-ink)]">Contact</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
