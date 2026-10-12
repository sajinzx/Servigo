import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'w-full border border-line bg-paper px-3 py-3 text-[15px] text-ink placeholder:text-muted ' +
  'transition-colors focus:border-accent focus:outline-none aria-[invalid=true]:border-crit';

interface Common {
  label: string;
  hint?: string;
  error?: string;
}

function Wrapper({ id, label, hint, error, children }: Common & { id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label block">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-crit">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ label, hint, error, className = '', ...rest }, ref) {
    const id = useId();
    return (
      <Wrapper id={id} label={label} hint={hint} error={error}>
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={`${control} ${className}`}
          {...rest}
        />
      </Wrapper>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, Common & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ label, hint, error, className = '', ...rest }, ref) {
    const id = useId();
    return (
      <Wrapper id={id} label={label} hint={hint} error={error}>
        <textarea
          ref={ref}
          id={id}
          rows={4}
          aria-invalid={error ? true : undefined}
          className={`${control} resize-y ${className}`}
          {...rest}
        />
      </Wrapper>
    );
  },
);

export const SelectField = forwardRef<HTMLSelectElement, Common & SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectField({ label, hint, error, className = '', children, ...rest }, ref) {
    const id = useId();
    return (
      <Wrapper id={id} label={label} hint={hint} error={error}>
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          className={`${control} ${className}`}
          {...rest}
        >
          {children}
        </select>
      </Wrapper>
    );
  },
);
