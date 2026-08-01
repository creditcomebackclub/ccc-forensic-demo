import { File, Upload } from 'lucide-react';
import { useFieldwork } from '../state';

export default function Documents() {
  const { documents, setDocuments } = useFieldwork();

  return (
    <div className="mx-auto max-w-3xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Documents</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Evidence vault</h1>
      <p className="mt-3 text-lg text-[var(--fw-muted)]">
        ID, proof of address, reports, and furnisher responses. Letters enclose ID + address — never your full credit report.
      </p>

      <button
        type="button"
        onClick={() => {
          setDocuments((docs) => [
            {
              id: `doc_${Date.now()}`,
              name: `Response_scan_${docs.length + 1}.pdf`,
              kind: 'Furnisher response',
              uploadedAt: new Date().toISOString(),
            },
            ...docs,
          ]);
        }}
        className="fw-btn-ink mt-8"
      >
        <Upload size={16} /> Upload demo file
      </button>

      <ul className="mt-6 divide-y divide-[var(--fw-line)] overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 px-4 py-3.5">
            <File size={18} className="shrink-0 text-[var(--fw-sea)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{doc.name}</div>
              <div className="text-xs text-[var(--fw-muted)]">
                {doc.kind} · {new Date(doc.uploadedAt).toLocaleString()}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
