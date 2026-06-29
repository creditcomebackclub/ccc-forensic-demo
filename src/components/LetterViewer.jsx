import React, { useState, useEffect } from 'react';
import { X, Loader2, Printer, Download, Mail } from 'lucide-react';
import { generateLetter } from '../utils/api';
import { supabase } from '../utils/supabase';

export default function LetterViewer({ account, client, onClose }) {
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchSigAndGenerate = async () => {
      let enrichedClient = { ...client };
      try {
        const { data: cp } = await supabase
          .from('client_profiles')
          .select('signature_data,full_name')
          .eq('full_name', client.name)
          .limit(1);
        if (cp && cp.length > 0 && cp[0].signature_data) {
          enrichedClient.signatureData = cp[0].signature_data;
        }
        if (!enrichedClient.signatureData) {
          const { data: c } = await supabase
            .from('clients')
            .select('lpoa_signature_data,name,address')
            .eq('name', client.name)
            .limit(1);
          if (c && c.length > 0 && c[0].lpoa_signature_data && c[0].lpoa_signature_data.signatureUrl) {
            enrichedClient.signatureData = c[0].lpoa_signature_data.signatureUrl;
          }
          // Use manually edited address if available
          if (c && c.length > 0) {
            enrichedClient.address = c[0].address || enrichedClient.address;
          }
        }
      } catch(e) { console.warn('Could not fetch signature:', e); }
      return generateLetter(account, enrichedClient);
    };
    fetchSigAndGenerate()
      .then((res) => {
        if (cancelled) return;
        setHtml(res.html);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [account, client]);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=1100');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = account.furnisher.replace(/[^a-z0-9]/gi, '_');
    a.href = url;
    a.download = `${(client.name || 'Client').replace(/[^a-z0-9]/gi, '_')}_${safeName}_Phase1.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 no-print">
      <div className="bg-white rounded max-w-4xl w-full max-h-[92vh] flex flex-col">
        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Mail size={14} className="text-navy" />
            <span className="text-[13px] font-medium text-ink">
              Phase 1 Letter — {account.furnisher}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {html && !loading && (
              <>
                <button
                  onClick={handleDownload}
                  className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-border text-ink-muted hover:bg-gray-50 flex items-center gap-1.5"
                >
                  <Download size={11} /> HTML
                </button>
                <button
                  onClick={handlePrint}
                  className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm bg-navy text-white hover:bg-navy-dark flex items-center gap-1.5"
                >
                  <Printer size={11} /> Print / Save as PDF
                </button>
              </>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
              <X size={14} className="text-ink-muted" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-gray-100 p-6">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 size={28} className="text-gold animate-spin mx-auto mb-3" />
                <div className="text-[13px] text-ink-muted">
                  Drafting forensic Phase 1 letter...
                </div>
                <div className="text-[11px] text-ink-faint mt-1">
                  Citing Metro 2 fields and FCRA violations
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="max-w-md mx-auto bg-red-50 border border-red-200 rounded p-4 text-[13px] text-red-900">
              <div className="font-medium mb-1">Letter generation failed</div>
              <div className="text-[12px]">{error}</div>
            </div>
          )}

          {html && !loading && (
            <div
              className="bg-white shadow-md mx-auto max-w-3xl letter-print-area"
              style={{ minHeight: '11in' }}
            >
              <iframe
                srcDoc={html}
                title="Phase 1 Letter"
                className="w-full"
                style={{ minHeight: '11in', border: 'none' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
