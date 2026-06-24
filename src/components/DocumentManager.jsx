import React, { useEffect, useState } from 'react';
import { Upload, FileText, Trash2, Eye, CheckCircle, AlertCircle } from 'lucide-react';
import { uploadDocument, getDocuments, getDocumentUrl, deleteDocument } from '../utils/documents';
import { supabase } from '../utils/supabase';

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

function ResponsesSection({ clientName, letters, setAnalyzingLetter }) {
  const [responses, setResponses] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => { loadResponses(); }, [clientName]);

  const loadResponses = async () => {
    try {
      // Get the user_id for this client from client_profiles
      const { data: cp } = await supabase
        .from('client_profiles')
        .select('user_id')
        .eq('full_name', clientName)
        .limit(1);

      if (!cp || cp.length === 0 || !cp[0].user_id) {
        setLoading(false);
        return;
      }

      const userId = cp[0].user_id;
      const { data: files } = await supabase.storage
        .from('responses')
        .list(userId, { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });

      if (!files || files.length === 0) { setLoading(false); return; }

      // For each folder (letter ID), list files inside
      const allResponses = [];
      for (const folder of files) {
        const { data: folderFiles } = await supabase.storage
          .from('responses')
          .list(userId + '/' + folder.name, { limit: 10 });
        if (folderFiles && folderFiles.length > 0) {
          // Match folder name (letter ID) to a letter to get furnisher
          const matchedLetter = letters.find(l => l.id === folder.name);
          folderFiles.forEach(f => {
            allResponses.push({
              path: userId + '/' + folder.name + '/' + f.name,
              letterId: folder.name,
              furnisher: matchedLetter ? matchedLetter.furnisher : folder.name,
              phase: matchedLetter ? matchedLetter.phase : 'Phase 1',
              fileName: f.name,
              createdAt: f.created_at,
              letter: matchedLetter || null,
            });
          });
        }
      }
      setResponses(allResponses);
    } catch(e) { console.error('Could not load responses:', e); }
    finally { setLoading(false); }
  };

  const handleDownload = async (path) => {
    try {
      const { data } = await supabase.storage.from('responses').createSignedUrl(path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    } catch(e) { alert('Could not open file'); }
  };

  const handleAnalyze = async (resp) => {
    if (!resp.letter) { alert('Could not find matching letter for this response.'); return; }
    try {
      const { data } = await supabase.storage.from('responses').createSignedUrl(resp.path, 3600);
      if (!data?.signedUrl) throw new Error('Could not get file URL');
      // Fetch the file and pass to ResponseAnalyzer
      const fileRes = await fetch(data.signedUrl);
      const blob = await fileRes.blob();
      const file = new File([blob], resp.fileName, { type: blob.type });
      setAnalyzingLetter({ ...resp.letter, _preloadedFile: file });
    } catch(e) { alert('Could not load response file: ' + e.message); }
  };

  if (loading) return <div className="text-[11px] text-ink-muted py-2">Loading responses…</div>;
  if (responses.length === 0) return (
    <div className="text-[11px] text-ink-muted py-2">No responses uploaded by client yet.</div>
  );

  return (
    <div className="space-y-2">
      {responses.map((resp, i) => (
        <div key={i} className="border border-border rounded-sm p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <FileText size={12} strokeWidth={1.75} className="text-navy shrink-0" />
                <span className="text-[12px] text-ink font-medium truncate">{resp.furnisher}</span>
              </div>
              <div className="text-[10px] text-ink-muted ml-4">
                {resp.phase} · {resp.createdAt ? new Date(resp.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => handleDownload(resp.path)}
                className="text-[10px] uppercase tracking-wider text-navy hover:text-gold flex items-center gap-1">
                <Eye size={11} strokeWidth={1.75} /> View
              </button>
              {resp.letter && (
                <button onClick={() => handleAnalyze(resp)}
                  className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm flex items-center gap-1"
                  style={{ background: '#1B2A4A', color: '#C9A84C' }}>
                  ⚡ Analyze
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DocumentManager({ clientName, letters, onChanged, setAnalyzingLetter }) {
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
      <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mt-4 mb-2">
        Client-Uploaded Responses
      </div>
      <ResponsesSection clientName={clientName} letters={letters || []} setAnalyzingLetter={setAnalyzingLetter} />
    </div>
  );
}
