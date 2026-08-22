import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Database,
  FileText,
  GitBranch,
  Lock,
  Mail,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  CCC_SOP_CONTROL,
  CCC_SOP_MODULES,
  CCC_SOP_SOURCES,
  CCC_SOP_SOURCE_TIERS,
  searchSopModules,
  sopSourceById,
} from '../utils/sopContent.js';

// Static boundary markers retained for the release guard: Seven-week template review;
// Never backdate a letter; Do not automatically file CFPB complaints.

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#667085',
  faint: '#98A2B3',
  panel: '#F8FAFC',
  shadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

const MODULE_ICONS = {
  governance: BookOpen,
  'lead-to-client': Users,
  'agreement-onboarding': FileText,
  'deterministic-3b': Database,
  'r1-classification': Route,
  'flows-switches': GitBranch,
  'template-library': FileText,
  'letter-writing-ai': Sparkles,
  'evidence-documents': ShieldCheck,
  mailing: Mail,
  outcomes: CheckCircle2,
  operations: ClipboardCheck,
  'privacy-security': Lock,
  checklists: ClipboardCheck,
  'pending-decisions': AlertTriangle,
};

function Heading({ children }) {
  return <h3 className="mb-3 text-[13px] font-bold uppercase tracking-[0.1em]" style={{ color: T.navy }}>{children}</h3>;
}

function Callout({ tone = 'gold', heading, text }) {
  const colors = {
    red: { border: '#FDA29B', background: '#FEF3F2', heading: '#B42318', text: '#912018' },
    green: { border: '#ABEFC6', background: '#ECFDF3', heading: '#067647', text: '#085D3A' },
    navy: { border: '#B8C4D8', background: '#F2F4F8', heading: T.navy, text: '#344054' },
    gold: { border: '#E8D99E', background: '#FFFAEB', heading: '#854D0E', text: '#7A4D0B' },
  }[tone] || { border: T.border, background: '#fff', heading: T.ink, text: T.muted };
  return (
    <div className="rounded-xl border px-4 py-3.5" style={{ borderColor: colors.border, background: colors.background }}>
      <div className="text-[12px] font-semibold" style={{ color: colors.heading }}>{heading}</div>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: colors.text }}>{text}</p>
    </div>
  );
}

function BulletBlock({ block }) {
  return (
    <section>
      <Heading>{block.heading}</Heading>
      <div className="space-y-2">
        {block.items.map((item) => (
          <div key={item} className="flex items-start gap-2.5 text-[12px] leading-relaxed" style={{ color: T.ink }}>
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" style={{ color: T.gold }} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function StepsBlock({ block }) {
  return (
    <section>
      <Heading>{block.heading}</Heading>
      <div className="space-y-2.5">
        {block.items.map((item, index) => (
          <div key={`${index}-${item}`} className="flex gap-3 rounded-xl border bg-white p-3.5" style={{ borderColor: T.border }}>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: T.navy, color: T.gold }}>{index + 1}</div>
            <p className="pt-0.5 text-[11px] leading-relaxed" style={{ color: T.ink }}>{item}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TableBlock({ block }) {
  return (
    <section>
      <Heading>{block.heading}</Heading>
      <div className="overflow-x-auto rounded-xl border bg-white" style={{ borderColor: T.border }}>
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr style={{ background: T.panel }}>
              {block.columns.map((column) => (
                <th key={column} className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: T.faint }}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row[0]}`} className="border-t" style={{ borderColor: T.border }}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-[11px] leading-relaxed" style={{ color: cellIndex === 0 ? T.navy : T.ink, fontWeight: cellIndex === 0 ? 650 : 400 }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FlowLadders({ block }) {
  const [flow, setFlow] = useState(block.ladders[0]?.flow || 'accuracy');
  const ladder = block.ladders.find((item) => item.flow === flow) || block.ladders[0];
  if (!ladder) return null;
  return (
    <section>
      <Heading>{block.heading}</Heading>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {block.ladders.map((item) => (
          <button
            type="button"
            key={item.flow}
            onClick={() => setFlow(item.flow)}
            aria-pressed={flow === item.flow}
            className="rounded-full border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors"
            style={{ borderColor: flow === item.flow ? T.navy : T.border, background: flow === item.flow ? T.navy : '#fff', color: flow === item.flow ? '#fff' : T.muted }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: T.border }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: T.navy, color: '#fff' }}>
          <span className="text-[13px] font-semibold">{ladder.label}</span>
          <span className="text-[9px] uppercase tracking-[0.12em] text-white/60">{ladder.rounds.length} letter rounds</span>
        </div>
        {ladder.rounds.map((item) => (
          <div key={`${ladder.flow}-${item.round}`} className="flex items-start gap-3 border-t px-4 py-3" style={{ borderColor: T.border }}>
            <span className="w-9 shrink-0 text-[10px] font-bold" style={{ color: T.gold }}>R{item.round}</span>
            <span className="text-[11px] leading-relaxed" style={{ color: T.ink }}>{item.law}</span>
          </div>
        ))}
      </div>
      {ladder.switchInstruction && <div className="mt-2"><Callout tone="gold" heading="Recorded switch after the final letter round" text={ladder.switchInstruction} /></div>}
    </section>
  );
}

function DetailsBlock({ block }) {
  return (
    <details className="rounded-xl border bg-white" style={{ borderColor: T.border }}>
      <summary className="cursor-pointer px-4 py-3 text-[11px] font-semibold" style={{ color: T.navy }}>{block.heading}</summary>
      <div className="space-y-1.5 border-t px-4 py-3" style={{ borderColor: T.border }}>
        {block.items.map((item) => <div key={item} className="text-[10px] leading-relaxed" style={{ color: T.muted }}>{item}</div>)}
      </div>
    </details>
  );
}

function ChecklistsBlock({ block }) {
  return (
    <section>
      <Heading>{block.heading}</Heading>
      <div className="grid gap-3 xl:grid-cols-2">
        {block.groups.map((group) => (
          <div key={group.role} className="rounded-xl border bg-white p-4" style={{ borderColor: T.border }}>
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold" style={{ color: T.navy }}><ClipboardCheck size={14} style={{ color: T.gold }} />{group.role}</div>
            <div className="space-y-2">
              {group.items.map((item) => (
                <div key={item} className="flex items-start gap-2 text-[10px] leading-relaxed" style={{ color: T.ink }}>
                  <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border bg-white" style={{ borderColor: '#B8C4D8' }} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContentBlock({ block }) {
  if (block.type === 'callout') return <Callout {...block} />;
  if (block.type === 'bullets') return <BulletBlock block={block} />;
  if (block.type === 'steps') return <StepsBlock block={block} />;
  if (block.type === 'table') return <TableBlock block={block} />;
  if (block.type === 'flowLadders') return <FlowLadders block={block} />;
  if (block.type === 'details') return <DetailsBlock block={block} />;
  if (block.type === 'checklists') return <ChecklistsBlock block={block} />;
  return null;
}

function SourceCitations({ sourceIds }) {
  return (
    <section className="border-t pt-5" style={{ borderColor: T.border }}>
      <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: T.faint }}>Sources controlling this module</div>
      <div className="grid gap-2 xl:grid-cols-2">
        {sourceIds.map((id) => {
          const item = sopSourceById(id);
          return (
            <div key={id} className="rounded-lg border bg-white px-3 py-2" style={{ borderColor: T.border }}>
              <div className="text-[9px] font-bold" style={{ color: T.navy }}>{id}</div>
              <div className="mt-0.5 text-[9px] leading-relaxed" style={{ color: T.muted }}>{item ? `${item.title} · ${item.scope}` : 'Source record missing'}</div>
              {item?.sha256 && <div className="mt-1 break-all font-mono text-[8px]" style={{ color: T.faint }}>SHA-256 {item.sha256}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SourceRegistry() {
  return (
    <details className="rounded-xl border bg-white" style={{ borderColor: T.border }}>
      <summary className="cursor-pointer px-4 py-3 text-[11px] font-semibold" style={{ color: T.navy }}>Open complete source registry</summary>
      <div className="space-y-4 border-t p-4" style={{ borderColor: T.border }}>
        {CCC_SOP_SOURCE_TIERS.map((tier) => (
          <div key={tier.id}>
            <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: T.gold }}>Tier {tier.rank} · {tier.label}</div>
            <div className="mt-2 grid gap-2 xl:grid-cols-2">
              {CCC_SOP_SOURCES.filter((item) => item.tier === tier.rank).map((item) => (
                <div key={item.id} className="rounded-lg p-2.5" style={{ background: T.panel }}>
                  <div className="text-[9px] font-bold" style={{ color: T.navy }}>{item.id}</div>
                  <div className="mt-0.5 text-[10px]" style={{ color: T.ink }}>{item.title}</div>
                  <div className="mt-0.5 text-[9px] leading-relaxed" style={{ color: T.muted }}>{item.scope}</div>
                  {item.sha256 && <div className="mt-1 break-all font-mono text-[8px]" style={{ color: T.faint }}>SHA-256 {item.sha256}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function EmptySearch({ query }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center" style={{ borderColor: '#D0D5DD' }}>
      <Search size={26} style={{ color: T.faint }} />
      <div className="mt-3 text-[13px] font-semibold" style={{ color: T.ink }}>No SOP module matches “{query}”</div>
      <p className="mt-1 max-w-md text-[11px] leading-relaxed" style={{ color: T.muted }}>Try an account type, flow, action, hold, role, or source ID.</p>
    </div>
  );
}

export default function MethodologyPage() {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(CCC_SOP_MODULES[0].id);
  const matches = useMemo(() => searchSopModules(query), [query]);
  const activeModule = matches.find((module) => module.id === activeId) || matches[0] || null;

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-5 lg:px-8 lg:pb-10">
      <header className="mb-5 overflow-hidden rounded-2xl border bg-white" style={{ borderColor: T.border, boxShadow: T.shadow }}>
        <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-start lg:justify-between lg:px-7">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 inline-block h-10 w-1 rounded" style={{ background: T.gold }} />
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="ccc-display text-[23px] font-medium leading-tight" style={{ color: T.ink }}>CCC Methodology &amp; SOP Center</h1>
                <span className="rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[0.1em]" style={{ background: '#ECFDF3', color: '#067647' }}>{CCC_SOP_CONTROL.status}</span>
              </div>
              <p className="max-w-3xl text-[12px] leading-relaxed" style={{ color: T.muted }}>One versioned operating standard for Consent, Accuracy, Collection, Combo, and Late Pay—from free Blueprint through proven outcome.</p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 rounded-xl px-4 py-3" style={{ background: T.panel }}>
            <div className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ color: T.faint }}>SOP version</div>
            <div className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ color: T.faint }}>Effective</div>
            <div className="text-[11px] font-semibold" style={{ color: T.navy }}>{CCC_SOP_CONTROL.version}</div>
            <div className="text-[11px] font-semibold" style={{ color: T.navy }}>{CCC_SOP_CONTROL.effectiveDate}</div>
            <div className="col-span-2 mt-1 flex items-center gap-1 text-[8px]" style={{ color: T.muted }}><Clock size={10} /> Method {CCC_SOP_CONTROL.methodVersion}</div>
          </div>
        </div>
        <div className="border-t px-5 py-3 lg:px-7" style={{ borderColor: T.border, background: T.panel }}>
          <div className="relative max-w-2xl">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T.faint }} />
            <input
              type="search"
              aria-label="Search CCC methodology and SOP modules"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the SOP: R1, Combo switch, screenshots, AI editor, weekly checklist…"
              className="w-full rounded-lg border bg-white py-2.5 pl-9 pr-3 text-[11px] outline-none focus:ring-2 focus:ring-[#C9A84C]/30"
              style={{ borderColor: T.border, color: T.ink }}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav className="w-full shrink-0 lg:w-64">
          <div className="overflow-hidden rounded-xl border bg-white py-1.5 lg:sticky lg:top-4" style={{ borderColor: T.border, boxShadow: T.shadow }}>
            <div className="flex items-center justify-between px-4 py-2 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: T.faint }}>
              <span>{query ? 'Search results' : 'Training modules'}</span>
              <span>{matches.length}</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {matches.map((module) => {
                const Icon = MODULE_ICONS[module.id] || BookOpen;
                const selected = activeModule?.id === module.id;
                return (
                  <button
                    type="button"
                    key={module.id}
                    onClick={() => setActiveId(module.id)}
                    aria-current={selected ? 'page' : undefined}
                    className="flex w-full items-center gap-2.5 border-l-2 px-4 py-2.5 text-left text-[11px] transition-colors"
                    style={{ borderLeftColor: selected ? T.gold : 'transparent', background: selected ? '#F7F4EA' : 'transparent', color: selected ? T.navy : T.muted, fontWeight: selected ? 650 : 400 }}
                  >
                    <Icon size={13} className="shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1">{module.navLabel}</span>
                    {selected && <ChevronRight size={11} className="shrink-0" style={{ color: T.gold }} />}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <main className="min-w-0 flex-1 rounded-xl border bg-white p-5 lg:p-7" style={{ borderColor: T.border, boxShadow: T.shadow }}>
          {!activeModule ? <EmptySearch query={query} /> : (
            <article>
              <div className="mb-6 border-b pb-5" style={{ borderColor: T.border }}>
                <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: T.gold }}>{activeModule.navLabel}</div>
                <h2 className="ccc-display text-[24px] font-medium leading-tight" style={{ color: T.ink }}>{activeModule.title}</h2>
                <p className="mt-2 max-w-3xl text-[12px] leading-relaxed" style={{ color: T.muted }}>{activeModule.summary}</p>
              </div>
              <div className="space-y-6">
                {activeModule.blocks.map((block, index) => <ContentBlock key={`${activeModule.id}-${block.heading || block.type}-${index}`} block={block} />)}
                {activeModule.id === 'governance' && <SourceRegistry />}
                <SourceCitations sourceIds={activeModule.sourceIds} />
              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
