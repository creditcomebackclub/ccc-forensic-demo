import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, File, FileUp, Loader2, Trash2 } from 'lucide-react';
import { useFieldwork } from '../state';
import { fieldworkCloudEnabled, getFieldworkDocumentUrl } from '../documents';

const KINDS = [
  { id: 'Photo ID', hint: 'Driver’s license / passport — enclosed with every mail packet' },
  { id: 'Proof of address', hint: 'Utility or bank statement — enclosed with every mail packet' },
  { id: 'Furnisher response', hint: 'What came back after you mailed — used for follow-up letters' },
  { id: 'Return receipt', hint: 'Certified mail green card / tracking proof' },
  { id: 'Prior letter', hint: 'Copy of a letter you already sent (for follow-up packets)' },
  { id: 'Credit report', hint: 'Kept for your records — never enclosed in mail packets' },
  { id: 'Other', hint: 'Anything else you want on file' },
];

function formatSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const {
    documents,
    uploadDocument,
    removeDocument,
    runtime,
    isGuestDemo,
    user,
  } = useFieldwork();
  const guest = isGuestDemo || user?.guest;
  const inputRef = useRef(null);
  const [kind, setKind] = useState('Photo ID');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const cloud = fieldworkCloudEnabled;

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      for (const file of files) {
        setStatus(`Uploading ${file.name}…`);
        await uploadDocument(kind, file);
      }
      setStatus(
        cloud
          ? `Saved to your Fieldwork vault${files.length > 1 ? ` (${files.length} files)` : ''}.`
          : 'Saved in this browser (demo mode). Connect Fieldwork Supabase for cloud vault.',
      );
    } catch (err) {
      console.error(err);
      setError(err.message || 'Upload failed');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (doc) => {
    try {
      if (doc.localDataUrl) {
        window.open(doc.localDataUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!doc.storagePath) {
        setError('This file has no stored bytes — re-upload it.');
        return;
      }
      const url = await getFieldworkDocumentUrl(doc.storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err.message || 'Could not open file');
    }
  };

  const onRemove = async (doc) => {
    setError('');
    try {
      await removeDocument(doc);
    } catch (err) {
      setError(err.message || 'Could not remove file');
    }
  };

  const hasId = documents.some((d) => d.kind === 'Photo ID' && (d.storagePath || d.localDataUrl));
  const hasAddress = documents.some((d) => d.kind === 'Proof of address' && (d.storagePath || d.localDataUrl));

  return (
    <div className="mx-auto max-w-3xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Documents</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Evidence vault</h1>
      <p className="mt-3 text-lg text-[var(--fw-muted)]">
        {guest
          ? 'Sample ID, address proof, and report metadata for the guest tour — create an account to upload real files.'
          : (
            <>
              Your ID, address proof, furnisher replies, and mail receipts — stored for real
              {cloud ? ' in Fieldwork Supabase' : ' in this browser until cloud keys are set'}.
              Credit reports stay here for you; they are never mailed to the furnisher.
            </>
          )}
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-xs">
        <span className={`rounded border px-2 py-1 ${hasId ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-[var(--fw-line)] text-[var(--fw-muted)]'}`}>
          Photo ID {hasId ? 'ready' : 'needed'}
        </span>
        <span className={`rounded border px-2 py-1 ${hasAddress ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-[var(--fw-line)] text-[var(--fw-muted)]'}`}>
          Proof of address {hasAddress ? 'ready' : 'needed'}
        </span>
        <span className="rounded border border-[var(--fw-line)] px-2 py-1 text-[var(--fw-muted)]">
          {guest ? 'Guest sample vault' : (cloud ? 'Cloud vault on' : `Demo vault · ${runtime.mode || 'local'}`)}
        </span>
      </div>

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

      {!guest && (
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
              {(kind === 'Photo ID' || kind === 'Proof of address')
                ? ' · Re-upload replaces the previous file.'
                : ''}
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
            {busy
              ? <Loader2 className="mx-auto animate-spin text-[var(--fw-sea)]" size={28} />
              : <FileUp className="mx-auto text-[var(--fw-sea)]" size={28} strokeWidth={1.5} />}
            <p className="mt-3 font-semibold">{busy ? 'Uploading…' : 'Drop files here'}</p>
            <p className="mt-1 text-sm text-[var(--fw-muted)]">PDF, JPG, or PNG · max 15 MB</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="fw-btn-ink mt-5 disabled:opacity-50"
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
          {status && <p className="mt-3 text-sm text-[var(--fw-sea)]">{status}</p>}
          {error && (
            <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
          )}
        </div>
      )}

      <div className="mt-10 rounded-lg border border-[rgba(20,80,95,0.15)] bg-[rgba(20,80,95,0.04)] px-4 py-4 text-sm leading-relaxed text-[var(--fw-ink)]/85">
        {guest ? (
          <>
            <strong className="font-semibold">Guest tour.</strong>{' '}
            This list shows the kinds of files a real account keeps for mail packets.
            Open{' '}
            <Link to="/app/responses" className="font-semibold text-[var(--fw-sea)] hover:underline">
              Responses
            </Link>
            {' '}to walk a sample reply analysis — no uploads in the tour.
          </>
        ) : (
          <>
            <strong className="font-semibold">Responses → follow-up letters.</strong>{' '}
            After you file a reply (or mark no response), open{' '}
            <Link to="/app/responses" className="font-semibold text-[var(--fw-sea)] hover:underline">
              Responses
            </Link>
            {' '}to analyze what they claimed. Files you upload here (and from Responses) land in this vault for enclosure packs.
          </>
        )}
      </div>

      <ul className="mt-6 divide-y divide-[var(--fw-line)] overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white">
        {documents.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-[var(--fw-muted)]">
            No documents yet — add photo ID and proof of address before your first send.
          </li>
        )}
        {documents.map((doc) => {
          const sizeLabel = formatSize(doc.size);
          const stored = Boolean(doc.storagePath || doc.localDataUrl);
          return (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-3.5">
              <File size={18} className="shrink-0 text-[var(--fw-sea)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{doc.name}</div>
                <div className="text-xs text-[var(--fw-muted)]">
                  {doc.kind}
                  {sizeLabel ? ` · ${sizeLabel}` : ''}
                  {' · '}
                  {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : '—'}
                  {' · '}
                  {guest
                    ? 'sample (tour only)'
                    : stored
                      ? (doc.cloud || doc.storagePath ? 'stored in cloud' : 'stored locally')
                      : 'metadata only — re-upload'}
                </div>
              </div>
              {!guest && stored && (
                <button
                  type="button"
                  onClick={() => openDoc(doc)}
                  className="rounded p-2 text-[var(--fw-muted)] hover:bg-black/5 hover:text-[var(--fw-ink)]"
                  title="Open"
                >
                  <ExternalLink size={16} />
                </button>
              )}
              {!guest && (
                <button
                  type="button"
                  onClick={() => onRemove(doc)}
                  className="rounded p-2 text-[var(--fw-muted)] hover:bg-black/5 hover:text-[var(--fw-ink)]"
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
