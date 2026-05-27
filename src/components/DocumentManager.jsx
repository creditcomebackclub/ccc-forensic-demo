import React, { useEffect, useState } from 'react';
import { Upload, FileText, Trash2, Eye, CheckCircle, AlertCircle } from 'lucide-react';
import { uploadDocument, getDocuments, getDocumentUrl, deleteDocument } from '../utils/documents';

const DOC_TYPES = [
  { key: 'id', label: 'Government ID', desc: "Driver's license or passport" },
  { key: 'address', label: 'Proof of Address', desc: 'Utility bill or bank statement' },
];

function DocSlot({ clientName, docType, label, desc, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const docs = await getDocuments(clientName);
      const found = docs.find((d) => d.doc_type === docType);
      setDoc(found || null);
    } catch (e) {
      console.error('Doc load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [clientName, docType]);

  const handleUpload = async (file) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { setError('PDF, JPG, PNG, or WEBP only'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('File must be under 10MB'); return; }
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(clientName, docType, file);
      await load();
      onChanged();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleView = async () => {
    try {
      const url = await getDocumentUrl(doc.storage_path);
      window.open(url, '_blank');
    } catch (e) { alert('Could not open document: ' + e.message); }
  };

  const handleDelete = async () => {
    if (!window.confirm('Remove ' + label + '?')) return;
    try {
      await deleteDocument(clientName, docType);
      setDoc(null);
      onChanged();
    } catch (e) { alert('Could not delete: ' + e.message); }
  };

  if (loading) return (
    <div className="border border-border rounded-sm p-3 bg-gray-50">
      <div className="text-[11px] text-ink-muted">Loading…</div>
    </div>
  );

  return (
    <div className="border border-border rounded-sm p-3">
      <div className="flex items-center justify-between mb-1">
        <div>
          <div className="flex items-center gap-1.5">
            {doc
              ? <CheckCircle size={12} strokeWidth={2} className="text-green-600" />
              : <AlertCircle size={12} strokeWidth={2} className="text-ink-faint" />}
            <span className="text-[12px] text-ink font-medium">{label}</span>
          </div>
          <div className="text-[10px] text-ink-muted ml-4">{desc}</div>
        </div>
        {doc && (
          <div className="flex items-center gap-2">
            <button onClick={handleView} className="text-[10px] uppercase tracking-wider text-navy hover:text-gold flex items-center gap-1">
              <Eye size={11} strokeWidth={1.75} /> View
            </button>
            <button onClick={handleDelete} className="text-[10px] uppercase tracking-wider text-ink-muted hover:text-red-600 flex items-center gap-1">
              <Trash2 size={11} strokeWidth={1.75} /> Remove
            </button>
          </div>
        )}
      </div>

      {doc ? (
        <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-muted">
          <FileText size={12} strokeWidth={1.75} className="text-navy" />
          <span className="truncate">{doc.file_name}</span>
          <span className="text-ink-faint shrink-0">
            · {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
      ) : (
        <div>
          <label
            className="flex items-center gap-2 mt-2 cursor-pointer text-[11px] uppercase tracking-wider text-navy hover:text-gold"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
          >
            <Upload size={12} strokeWidth={1.75} />
            {uploading ? 'Uploading…' : 'Upload'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={(e) => { if (e.target.files[0]) handleUpload(e.target.files[0]); }} />
          </label>
          {error && <div className="text-[10px] text-red-600 mt-1">{error}</div>}
        </div>
      )}
    </div>
  );
}

export default function DocumentManager({ clientName, onChanged }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">
        Identity Documents
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DOC_TYPES.map((dt) => (
          <DocSlot
            key={dt.key}
            clientName={clientName}
            docType={dt.key}
            label={dt.label}
            desc={dt.desc}
            onChanged={onChanged}
          />
        ))}
      </div>
      <div className="text-[10px] text-ink-faint mt-2 leading-relaxed">
        Documents stored securely and attached as enclosures when mailing via Lob.
      </div>
    </div>
  );
}
