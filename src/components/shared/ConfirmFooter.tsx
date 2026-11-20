import type { ReactNode } from 'react';

interface Props {
  onCancel(): void;
  onConfirm(): unknown;
  confirmLabel: ReactNode;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** 작업 중이면 [취소]도 막습니다. */
  busy?: boolean;
  confirmDisabled?: boolean;
  autoFocus?: boolean;
}

/** 확인 창 아래쪽의 [취소]·[확인] 단추 한 쌍 (Modal의 footer로 씁니다) */
export function ConfirmFooter({ onCancel, onConfirm, confirmLabel, cancelLabel = '취소', tone = 'primary', busy = false, confirmDisabled = false, autoFocus = false }: Props) {
  return (
    <>
      <button className="btn" onClick={onCancel} disabled={busy}>
        {cancelLabel}
      </button>
      <button className={tone === 'danger' ? 'btn-danger' : 'btn-primary'} autoFocus={autoFocus} onClick={() => void onConfirm()} disabled={busy || confirmDisabled}>
        {confirmLabel}
      </button>
    </>
  );
}
