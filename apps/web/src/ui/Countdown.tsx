import { useEffect, useState } from 'react';

/** Seconds left until `expiresAt`, ticking once a second; never below zero. */
export function useSecondsLeft(expiresAt: string | Date, now: () => number = Date.now): number {
  const target = new Date(expiresAt).getTime();
  const calc = () => Math.max(0, Math.ceil((target - now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return left;
}

/** The offer card's countdown ring. */
export function CountdownRing({
  expiresAt,
  total = 90,
  size = 72,
}: {
  expiresAt: string | Date;
  total?: number;
  size?: number;
}) {
  const left = useSecondsLeft(expiresAt);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, left / total);
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`${left} seconds left to respond`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={left <= 15 ? 'var(--crit)' : 'var(--accent)'}
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span className="mono absolute text-lg">{left}</span>
    </div>
  );
}
