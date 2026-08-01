import { useEffect, useRef } from 'react';

/**
 * Canvas signature pad — same pattern as CCC client portal.
 * Calls onChange(dataUrl | null) when the user finishes a stroke or clears.
 */
export default function SignaturePad({ value, onChange, className = '' }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const seeded = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#07131f';
    ctx.lineWidth = 2.5;

    // Seed existing signature once (avoid redraw loops while drawing)
    if (value && !seeded.current) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        seeded.current = true;
      };
      img.src = value;
    }
  }, [value]);

  const point = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  };

  const start = (e) => {
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    seeded.current = true;
    onChange?.(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    seeded.current = false;
    onChange?.(null);
  };

  return (
    <div className={className}>
      <div className="overflow-hidden rounded border border-[var(--fw-line)] bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={180}
          className="block w-full touch-none cursor-crosshair bg-[rgba(242,245,247,0.6)]"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--fw-muted)]">
          Draw with mouse or finger. This goes on every mailed letter.
        </p>
        <button
          type="button"
          onClick={clear}
          className="shrink-0 text-xs font-semibold text-[var(--fw-sea)] hover:underline"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
