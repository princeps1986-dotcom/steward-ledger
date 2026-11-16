import { useSettingsPage } from '../../../hooks/useSettingsPage';
import { InfoTip } from '../../shared/InfoTip';
import { Modal } from '../../shared/Modal';
import { Notice } from '../../shared/Notice';
import { ThemePicker } from '../../shared/ThemePicker';

export function SettingsPage() {
  const s = useSettingsPage();
  return (
    <div className="max-w-3xl space-y-4">
      <Notice message={s.message} />

      <section className="card space-y-3">
        <h3 className="font-semibold">
          기본 설정 <span className="ml-1 text-xs font-normal text-gray-500">[설정 저장]을 눌러야 적용됩니다</span>
        </h3>
        <label className="block">
          <span className="label">기본 메일 주소 ([메일 저장] 수신인)</span>
          <input className="input" type="email" value={s.email} onChange={(e) => s.setEmail(e.target.value)} placeholder="finance@example.org" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">큰 금액 확인 기준 (이 금액 초과 시 확인창)</span>
            <input className="input text-right" inputMode="numeric" value={s.threshold} onChange={(e) => s.setThreshold(e.target.value)} />
          </label>
          <label>
            <span className="label">백업 권고 주기 (일)</span>
            <input className="input text-right" inputMode="numeric" value={s.reminderDays} onChange={(e) => s.setReminderDays(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={() => void s.saveGeneral()} disabled={!s.dirty}>
            설정 저장
          </button>
          {s.dirty ? <span className="text-sm text-amber-700">저장하지 않은 변경이 있습니다.</span> : null}
        </div>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold">
          화면 · 입력 <span className="ml-1 text-xs font-normal text-gray-500">바꾸면 바로 적용됩니다</span>
        </h3>
        <ThemePicker legend="화면 테마" value={s.theme} options={s.themeOptions} onChange={s.changeTheme} />
        <ThemePicker legend="인쇄 양식 색상 (보고서 인쇄)" value={s.printTheme} options={s.printThemeOptions} onChange={s.changePrintTheme} />
        <label className="block w-48">
          <span className="label">화면 글자 크기</span>
          <select className="input" value={s.fontScale} onChange={(e) => s.changeFontScale(e.target.value as typeof s.fontScale)}>
            {s.fontScaleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold">
          자동 로컬 백업 <span className="ml-1 text-xs font-normal text-gray-500">바꾸면 바로 적용됩니다</span>
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.autoBackupEnabled} disabled={!s.isDesktop} onChange={(e) => s.toggleAutoBackup(e.target.checked)} />
          앱 종료 시 변경 사항이 있으면 자동 백업 (최근 10개 보관)
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">저장 폴더:</span>
          <code className="flex-1 truncate rounded bg-gray-100 px-2 py-1">{s.backupDir}</code>
          <button className="btn" onClick={() => void s.selectDir()} disabled={!s.isDesktop}>
            폴더 선택
          </button>
          {s.isCustomDir ? (
            <button className="btn" onClick={s.resetDir}>
              기본 폴더로
            </button>
          ) : null}
        </div>
        <p className="text-sm text-gray-600">마지막 백업: {s.lastBackupLabel}</p>
      </section>

      <section className="card space-y-3">
        <h3 className="flex items-center gap-2 font-semibold">
          전체 백업 · 복원
          <InfoTip label="전체 백업·복원 안내" text={s.backupHelp} />
        </h3>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => void s.backupNow()} disabled={s.busy}>
            지금 백업 파일 저장
          </button>
          <label className="btn cursor-pointer">
            백업 파일로 복원…
            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => void s.onRestoreFile(e)} />
          </label>
        </div>
      </section>

      <Modal
        open={!!s.restore}
        onClose={s.cancelRestore}
        title="백업 파일로 복원할까요?"
        description="현재 앱의 모든 데이터가 백업 파일 내용으로 바뀝니다."
        footer={
          <>
            <button className="btn" onClick={s.cancelRestore}>
              취소
            </button>
            <button className="btn-danger" onClick={() => void s.confirmRestore()} disabled={s.busy}>
              긴급 백업 후 복원
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p>
            파일: <b>{s.restore?.fileName}</b>
          </p>
          <p>{s.restore?.summary}</p>
          {s.restore?.migratedFrom ? <p className="text-amber-700">구버전(v{s.restore.migratedFrom}) 백업입니다. v2 형식으로 자동 변환됩니다.</p> : null}
          <p className="text-gray-600">무결성 검증을 통과했습니다.</p>
        </div>
      </Modal>
    </div>
  );
}
