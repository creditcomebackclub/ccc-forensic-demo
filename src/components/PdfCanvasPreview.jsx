import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Renders a PDF into canvases on the page origin.
 * Prefer `data` (Uint8Array) so we never fetch blob: URLs — CSP connect-src
 * often blocks those and surfaces as "Failed to fetch".
 */
export default function PdfCanvasPreview({ data, src, className = '' }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!data && !src) return undefined;
    let cancelled = false;
    const host = hostRef.current;

    const run = async () => {
      setStatus('loading');
      setError(null);
      if (host) host.innerHTML = '';
      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        let bytes = data;
        if (!bytes) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`Could not load PDF (${res.status}).`);
          bytes = new Uint8Array(await res.arrayBuffer());
        }

        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled || !hostRef.current) return;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled || !hostRef.current) return;
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'w-full h-auto bg-white shadow-sm mb-3 last:mb-0';
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (cancelled || !hostRef.current) return;
          hostRef.current.appendChild(canvas);
        }
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'PDF preview failed.');
          setStatus('error');
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      if (host) host.innerHTML = '';
    };
  }, [data, src]);

  return (
    <div className={`relative overflow-auto bg-slate-200/40 rounded-lg ${className}`}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 gap-2">
          <Loader2 size={14} className="animate-spin" /> Rendering preview…
        </div>
      )}
      {status === 'error' && (
        <div className="p-6 text-center text-xs text-red-700">
          {error}
          <div className="mt-2 text-slate-500">Use “Open PDF in new tab” if the preview stays blank.</div>
        </div>
      )}
      <div ref={hostRef} className="p-3 min-h-[200px]" />
    </div>
  );
}
