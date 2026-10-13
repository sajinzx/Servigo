import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

/** Accessible modal (focus trap, escape to close, aria labelling) restyled to the tokens. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 border border-line bg-paper p-6 shadow-none">
          <Dialog.Title className="display text-3xl">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-2 text-muted">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="mt-6">{children}</div>
          <Dialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 text-muted hover:text-ink"
          >
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
