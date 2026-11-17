import type { useBackupReminder } from '../../hooks/useAppShell';

type Props = ReturnType<typeof useBackupReminder>;

export function BackupReminderBanner({ visible, text, tone, busy, canBackup, backupNow, dismiss }: Props) {
  if (!visible) return null;
  const color = tone === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900';
  return (
    <div className={`no-print flex items-center gap-3 border-b px-4 py-2 text-sm ${color}`}>
      <span className="flex-1">{text}</span>
      {canBackup ? (
        <button className="btn" onClick={backupNow} disabled={busy}>
          지금 백업
        </button>
      ) : null}
      <button className="btn" onClick={dismiss}>
        닫기
      </button>
    </div>
  );
}
