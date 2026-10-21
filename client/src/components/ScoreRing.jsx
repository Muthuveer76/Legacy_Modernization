import { scoreTone } from '../lib/format.js';

export function ScoreRing({ score, size = 96, label = 'Fidelity' }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = score == null ? 0 : Math.max(0, Math.min(100, score));
  const tone = scoreTone(score);
  return (
    <div className={`score-ring tone-${tone}`} style={{ width: size, height: size }} aria-label={`${label} score ${score ?? 'not available'}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-value"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">
        <strong>{score ?? '–'}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
