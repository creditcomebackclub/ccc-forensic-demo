import React, { useEffect, useState } from 'react';
import { Upload, FileText, Trash2, Eye, CheckCircle, Zap } from 'lucide-react';
import { uploadDocument, getDocuments, getDocumentUrl, deleteDocument } from '../utils/documents';
import { supabase } from '../utils/supabase';
import { CONVERTED_PREFIX, inferMediaType, isAnalyzable, UNSUPPORTED_TYPE_MESSAGE } from '../utils/responseFiles';

// Brand tokens — matches the dashboard / clients card system
const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
};

const DOC_TYPES = [
  { key: 'id', label: 'Government ID', desc: "Driver's license or passport" },
  { key: 'address', label: 'Proof of Address', desc: 'Utility bill or bank statement' },
];

function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <span style={{ width: 3, height: 12, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
        <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: T.muted }}>{children}</div>
      </div>
      {right}
    </div>
  );
}

function DocSlot({ clientName, docType, label, desc, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
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
    <div style={{ border: '1px solid ' + T.border, borderRadius: 10, padding: 16, background: '#FAFBFC' }}>
      <div className="text-[11px]" style={{ color: T.muted }}>Loading…</div>
    </div>
  );

  if (!doc) {
    return (
      <div>
        <label
          className="flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors text-center"
          style={{
            border: '2px dashed ' + (dragging ? T.navy : '#D9DEE8'),
            borderRadius: 10, padding: '18px 14px',
            background: dragging ? '#F5F7FB' : '#fff',
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
        >
          <Upload size={16} strokeWidth={1.5} style={{ color: T.faint }} />
          <span className="text-[12px] font-medium" style={{ color: T.ink }}>
            {uploading ? 'Uploading…' : 'Upload ' + label}
          </span>
          <span className="text-[10px]" style={{ color: T.faint }}>{desc} · PDF, JPG, PNG · drop or click</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
            onChange={(e) => { if (e.target.files[0]) handleUpload(e.target.files[0]); }} />
        </label>
        {error && <div className="text-[10px] text-red-600 mt-1">{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid ' + T.border, borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
      <div className="flex items-center gap-3">
        <div className="shrink-0 flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 8, background: '#EEF1F7' }}>
          <FileText size={15} strokeWidth={1.75} style={{ color: T.navy }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: T.ink }}>{label}</span>
            <CheckCircle size={12} strokeWidth={2} className="text-green-600 shrink-0" />
          </div>
          <div className="text-[10px] truncate" style={{ color: T.muted }}>
            {doc.file_name} · {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={handleView} title="View document"
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border transition-colors hover:border-navy hover:text-navy"
            style={{ borderColor: T.border, color: T.muted }}>
            <Eye size={11} strokeWidth={1.75} /> View
          </button>
          <button onClick={handleDelete} title={'Remove ' + label}
            className="flex items-center justify-center rounded-md transition-colors hover:bg-red-50 hover:text-red-600"
            style={{ width: 24, height: 24, color: T.faint }}>
            <Trash2 size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>
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
          // Hide system artifacts: PDF pages converted to JPEGs for Lob
          // exhibit embedding live in the same folder but aren't uploads
          folderFiles.filter(f => !f.name.startsWith(CONVERTED_PREFIX)).forEach(f => {
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
      // Fetch the file and pass to ResponseAnalyzer. Storage downloads can
      // come back typeless — infer from the extension before analysis.
      const fileRes = await fetch(data.signedUrl);
      const blob = await fileRes.blob();
      const mediaType = inferMediaType(resp.fileName, blob.type);
      if (!isAnalyzable(mediaType)) { alert(UNSUPPORTED_TYPE_MESSAGE); return; }
      const file = new File([blob], resp.fileName, { type: mediaType });
      // _fromStorage: the file already lives in the responses bucket — the
      // analyzer must not re-save it (only convert PDFs for Lob embedding)
      setAnalyzingLetter({ ...resp.letter, _preloadedFile: file, _fromStorage: true });
    } catch(e) { alert('Could not load response file: ' + e.message); }
  };

  if (loading) return <div className="text-[11px] py-2" style={{ color: T.muted }}>Loading responses…</div>;
  if (responses.length === 0) return (
    <div className="text-center" style={{ border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 14px', background: '#FAFBFC' }}>
      <div className="text-[11px]" style={{ color: T.muted }}>No responses uploaded by the client yet.</div>
      <div className="text-[10px] mt-0.5" style={{ color: T.faint }}>Files the client uploads in their portal appear here.</div>
    </div>
  );

  return (
    <div style={{ border: '1px solid #EBEEF3', borderRadius: 10 }}>
      {responses.map((resp, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: T.grid }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, background: '#EEF1F7' }}>
              <FileText size={13} strokeWidth={1.75} style={{ color: T.navy }} />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-medium truncate" style={{ color: T.ink }}>{resp.furnisher}</div>
              <div className="text-[10px] truncate" style={{ color: T.muted }}>
                {resp.phase} · {resp.createdAt ? new Date(resp.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => handleDownload(resp.path)} title="View response file"
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border transition-colors hover:border-navy hover:text-navy"
              style={{ borderColor: T.border, color: T.muted }}>
              <Eye size={11} strokeWidth={1.75} /> View
            </button>
            {resp.letter && (
              <button onClick={() => handleAnalyze(resp)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md"
                style={{ background: T.navy, color: T.gold }}>
                <Zap size={10} strokeWidth={2} /> Analyze
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DocumentManager({ clientName, letters, onChanged, setAnalyzingLetter }) {
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel>Identity Documents</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
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
        <div className="text-[10px] mt-2 leading-relaxed" style={{ color: T.faint }}>
          Documents are stored securely and attached as enclosures when mailing via Lob.
        </div>
      </div>
      <div>
        <SectionLabel>Client-Uploaded Responses</SectionLabel>
        <ResponsesSection clientName={clientName} letters={letters || []} setAnalyzingLetter={setAnalyzingLetter} />
      </div>
    </div>
  );
}
