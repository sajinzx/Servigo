import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={`border border-line bg-paper p-5 sm:p-6 ${className}`}>{children}</Tag>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border-t border-ink pt-3">
      <p className="label">{label}</p>
      <p className="mono mt-1 text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-10 sm:pt-14">
      <div>
        {eyebrow ? <p className="label mb-3">{eyebrow}</p> : null}
        <h1 className="text-4xl sm:text-5xl">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function Chip({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  const cls = `border px-3 py-1.5 text-sm transition-colors ${
    selected ? 'border-ink bg-ink text-paper' : 'border-line hover:border-ink'
  }`;
  return onClick ? (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cls}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function Money({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

export function Divider() {
  return <hr className="border-0 border-t border-line" />;
}
