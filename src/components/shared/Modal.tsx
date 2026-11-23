import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
  onCloseAutoFocus?(e: Event): void;
  /** true면 내용이 창 밖으로 넘쳐 보일 수 있습니다(달력 팝업이 창 높이를 늘리지 않고 위에 겹쳐 뜸). 내용이 짧은 창에만 씁니다. */
  overflowVisible?: boolean;
}

export function Modal({ open, onClose, title, description, children, footer, widthClass = 'max-w-lg', onCloseAutoFocus, overflowVisible = false }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] ${widthClass} -translate-x-1/2 -translate-y-1/2 ${overflowVisible ? 'overflow-visible' : 'overflow-y-auto'} rounded-lg bg-white p-5 shadow-xl outline-none`}
          onCloseAutoFocus={onCloseAutoFocus}
          onPointerDownOutside={(e) => e.preventDefault()}
          // 설명이 없으면 Radix 권장대로 aria-describedby를 명시적 undefined로 넘겨 제목을 두 번 읽지 않게 합니다.
          {...(!description && { 'aria-describedby': undefined })}
        >
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          {description ? <Dialog.Description className="mt-1 text-sm text-gray-500">{description}</Dialog.Description> : null}
          <div className="mt-4">{children}</div>
          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
