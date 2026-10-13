import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const base =
  'inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium tracking-wide ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  // solid ink-on-paper for the one primary action on a screen
  primary: 'bg-ink text-paper hover:opacity-90',
  secondary: 'border border-ink text-ink hover:bg-ink hover:text-paper',
  ghost: 'text-ink underline-offset-4 hover:underline px-0',
  danger: 'border border-crit text-crit hover:bg-crit hover:text-paper',
};

export const buttonClass = (variant: Variant = 'primary', extra = '') => `${base} ${variants[variant]} ${extra}`;

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', loading, disabled, children, className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, className)}
    >
      {loading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
});

export function LinkButton({
  variant = 'primary',
  className = '',
  ...rest
}: LinkProps & { variant?: Variant }) {
  return <Link {...rest} className={buttonClass(variant, className)} />;
}
