import { useMemo } from 'react';
import { toQR } from 'toqr';

/** A QR code drawn as one SVG path, dark on white with a quiet zone so phone cameras read it in dark mode too. */
export function QrCode({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    // toqr returns n×n modules row by row, 1 = dark.
    const cells = toQR(text);
    const n = Math.sqrt(cells.length) | 0;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cells[y * n + x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { n, d };
  }, [text]);
  const extent = n + 8;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${extent} ${extent}`} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
      <rect width={extent} height={extent} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
