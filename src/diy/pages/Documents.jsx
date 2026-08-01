import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { File, FileUp, Trash2 } from 'lucide-react';
import { useFieldwork } from '../state';

const KINDS = [
  { id: 'Photo ID', hint: 'Driver’s license / passport — enclosed with every mail packet' },
  { id: 'Proof of address', hint: 'Utility or bank statement — enclosed with every mail packet' },
  { id: 'Furnisher response', hint: 'What came back after you mailed — used for follow-up letters' },
  { id: 'Return receipt', hint: 'Certified mail green card / tracking proof' },
  { id: 'Prior letter', hint: 'Copy of a letter you already sent (for follow-up packets)' },
  { id: 'Credit report', hint: 'Kept for your records — never enclosed in mail packets' },
  { id: 'Other', hint: 'Anything else you want on file' },
];

export default function Documents() {
  const { documents, setDocuments } = useFieldwork();
  const inputRef = useRef(null);
  const [kind, setKind] = useState('Furnisher response');
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setDocuments((docs) => [
      ...files.map((file, i) => ({
        id: `doc_${Date.now()}_${i}`,
        name: file.name,
        kind,
        uploadedAt: new Date().toISOString(),
        size: file.size,
      })),
      ...docs,
    ]);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Documents</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Evidence vault</h1>
      <p className="mt-3 text-lg text-[var(--fw-muted)]">
        Your ID, address proof, furnisher replies, and mail receipts — ready to attach when you send.
        Credit reports stay here for you; they are never mailed to the furnisher.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-4">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-sea)]">Opening packet</div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--fw-ink)]/85">
            Dispute letter + photo ID + proof of address. That’s the first certified send.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--fw-line)] bg-white p-4">
          <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-sea)]">Follow-up packet</div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--fw-ink)]/85">
            After they reply (or stonewall): new letter + their response + return receipt + your prior letter + ID docs.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <label className="block">
          <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">File type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 text-sm outline-none ring-[var(--fw-sea)] focus:ring-1 md:max-w-sm"
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.id}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-[var(--fw-muted)]">
            {KINDS.find((k) => k.id === kind)?.hint}
          </p>
        </label>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`mt-4 rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
            dragOver
              ? 'border-[var(--fw-signal-dim)] bg-[rgba(46,230,166,0.08)]'
              : 'border-[var(--fw-line)] bg-white'
          }`}
        >
          <FileUp className="mx-auto text-[var(--fw-sea)]" size={28} strokeWidth={1.5} />
          <p className="mt-3 font-semibold">Drop files here</p>
          <p className="mt-1 text-sm text-[var(--fw-muted)]">PDF, JPG, or PNG</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="fw-btn-ink mt-5"
          >
            Choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="mt-10 rounded-lg border border-[rgba(20,80,95,0.15)] bg-[rgba(20,80,95,0.04)] px-4 py-4 text-sm leading-relaxed text-[var(--fw-ink)]/85">
        <strong className="font-semibold">Responses → follow-up letters.</strong>{' '}
        After you file a reply (or mark no response), open{' '}
        <Link to="/app/responses" className="font-semibold text-[var(--fw-sea)] hover:underline">
          Responses
        </Link>
        {' '}to see what they claimed vs dodged. Starter gets talking points; Pro and Campaign auto-draft the
        Phase 2 follow-up letter and hand it into mail with the right enclosures.
      </div>

      <ul className="mt-6 divide-y divide-[var(--fw-line)] overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white">
        {documents.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--fw-muted)]">
            No documents yet — add photo ID and proof of address before your first send.
          </li>
        )}
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 px-4 py-3.5">
            <File size={18} className="shrink-0 text-[var(--fw-sea)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{doc.name}</div>
              <div className="text-xs text-[var(--fw-muted)]">
                {doc.kind} · {new Date(doc.uploadedAt).toLocaleString()}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDocuments((docs) => docs.filter((d) => d.id !== doc.id))}
              className="rounded p-2 text-[var(--fw-muted)] hover:bg-black/5 hover:text-[var(--fw-ink)]"
              title="Remove"
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
