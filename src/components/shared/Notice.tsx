interface Props {
  message: { kind: 'error' | 'info'; text: string } | string | null;
  /** 메시지 옆에 붙는 보조 동작 단추 (예: 되돌리기) */
  action?: { label: string; onClick(): void };
  /** 여러 개의 보조 동작 단추 (예: 파일 열기, 폴더 열기) */
  actions?: { label: string; onClick(): void }[];
}

const STYLE = {
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export function Notice({ message, action, actions }: Props) {
  if (!message) return null;
  const buttons = actions ?? (action ? [action] : []);
  const m = typeof message === 'string' ? { kind: 'info' as const, text: message } : message;
  return (
    <div role="status" className={`flex items-center gap-3 rounded border px-3 py-2 text-sm ${STYLE[m.kind]}`}>
      <span className="flex-1">{m.text}</span>
      {buttons.map((b) => (
        <button key={b.label} type="button" className="btn shrink-0 px-2 py-0.5 text-xs" onClick={b.onClick}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
