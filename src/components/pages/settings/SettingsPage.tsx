import { useSettingsPage } from '../../../hooks/useSettingsPage';
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
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="label">큰 금액 확인 기준 (이 금액 초과 시 확인창)</span>
            <input className="input text-right" inputMode="numeric" value={s.threshold} onChange={(e) => s.setThreshold(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={() => void s.saveGeneral()} disabled={!s.dirty}>
            설정 저장
          </button>
          <button className="btn" onClick={s.cancelGeneral} disabled={!s.dirty}>
            입력 취소
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
          <input type="checkbox" checked={s.autoBackupEnabled} disabled={!s.isDesktop || s.backupBlocked} onChange={(e) => s.toggleAutoBackup(e.target.checked)} />
          변경 사항이 있으면 자동 백업: 앱 종료 시(최근 10개 보관)와 사용 중 10분마다(최근 3개 보관)
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">저장 폴더:</span>
          <code className="flex-1 truncate rounded bg-gray-100 px-2 py-1">{s.backupDir}</code>
          <button className="btn" onClick={() => void s.selectDir()} disabled={!s.isDesktop || s.backupBlocked}>
            폴더 선택
          </button>
          {s.isCustomDir ? (
            <button className="btn" onClick={s.resetDir} disabled={s.backupBlocked}>
              기본 폴더로
            </button>
          ) : null}
        </div>
        <p className="text-sm text-gray-600">마지막 백업: {s.lastBackupLabel}</p>
        {s.backupBlocked ? <p className="text-sm font-semibold text-red-700">시연 데이터를 쓰는 동안에는 백업·복원과 자동 백업을 쓸 수 없습니다. [시연 데이터 제거] 후 다시 쓸 수 있습니다.</p> : null}
      </section>

      <section className="card space-y-3">
        <h3 className="flex items-center gap-2 font-semibold">
          백업 · 복원
        </h3>
        <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600">{s.backupHelp}</p>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={s.openBackup} disabled={s.busy || s.backupBlocked}>
            백업 파일 저장
          </button>
          <label className={`btn ${s.backupBlocked ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`} aria-disabled={s.backupBlocked}>
            백업 파일 복원
            <input type="file" accept=".json,.gz,application/json" className="hidden" disabled={s.backupBlocked} onChange={(e) => void s.onRestoreFile(e)} />
          </label>
        </div>
      </section>

      <Modal
        open={s.backupOpen}
        onClose={s.cancelBackup}
        title="백업 파일을 저장할까요?"
        description="백업할 연도를 선택하고 확인하세요."
        footer={
          <>
            <button className="btn" onClick={s.cancelBackup} disabled={s.busy}>
              취소
            </button>
            <button className="btn-primary" onClick={() => void s.backupNow()} disabled={s.busy || !s.backupYear}>
              {s.busy ? '저장하는 중…' : `${s.backupYear}년 백업 파일 저장`}
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-600" htmlFor="backup-year">
            백업할 연도
          </label>
          <select id="backup-year" className="input w-28" value={s.backupYear} onChange={(e) => s.setBackupYear(e.target.value)} disabled={s.backupYearOptions.length === 0 || s.busy}>
            {s.backupYearOptions.length === 0 ? <option value="">연도 없음</option> : null}
            {s.backupYearOptions.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {s.backupYearOptions.length === 0 ? (
            '헌금 내역이 있는 연도만 백업할 수 있습니다.'
          ) : (
            <>
              <b className="text-red-700 underline">선택한 연도</b>의 헌금과 성도·헌금 종류가 함께 저장됩니다.<br/>다른 연도의 내역은 이 백업 파일에 들어가지 않습니다.
            </>
          )}
        </p>
      </Modal>

      {/* 현재 데이터를 지우거나 통째로 바꾸는 동작은 일반 백업·복원과 떨어뜨려 경고와 함께 둡니다. */}
      <section className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4" aria-labelledby="danger-zone-title">
        <h3 id="danger-zone-title" className="flex items-center gap-1.5 font-semibold text-red-700">
          <span aria-hidden="true">⚠</span> 위험 구역
        </h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-danger-outline whitespace-nowrap" onClick={s.openDemo} disabled={s.busy || s.demoActive}>
            시연 데이터 생성
          </button>
          {s.demoActive || s.demoCreating ? (
            <button className="btn-danger whitespace-nowrap" onClick={s.openRemoveDemo} disabled={s.busy || s.demoCreating}>
              시연 데이터 제거
            </button>
          ) : null}
          <button className="btn-danger whitespace-nowrap" onClick={s.openReset} disabled={s.busy || s.demoActive || !s.hasData}>
            전체 초기화
          </button>
        </div>
        {s.demoCreating ? <p className="text-sm font-semibold text-red-700">시연 데이터를 만드는 중에는 제거할 수 없습니다. 끝나면 사용할 수 있습니다.</p> : null}
        {s.demoActive ? <p className="text-sm text-red-700">시연 데이터가 있는 동안에는 시연 데이터 생성과 전체 초기화를 쓸 수 없습니다.<br/>먼저 [시연 데이터 제거]를 누르세요.</p> : null}
      </section>

      <Modal
        open={s.demoOpen}
        onClose={s.cancelDemo}
        title="시연 데이터를 생성할까요?"
        description="가상의 시연 데이터가 만들어집니다. 시연이 끝나면 [시연 데이터 제거]로 빈 상태로 되돌립니다."
        footer={
          <>
            <button className="btn" onClick={s.cancelDemo} disabled={s.busy}>
              취소
            </button>
            <button className="btn-danger" onClick={() => void s.confirmDemo()} disabled={s.busy}>
              {s.demoProgress ? `만드는 중… ${s.demoProgress.done}/${s.demoProgress.total}` : '시연 데이터 생성'}
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          {s.demoBrowser ? (
            <p>가상의 성도 800명과 헌금 약 6.3만 건(최근 18개월, 주 500~1,333건, 매년 12/25·1/1은 하루 3,333건), 수정·삭제 이력 6건이 들어갑니다. 브라우저에서는 이 규모로 만들며 몇 초면 쓸 수 있고 나머지는 뒤에서 이어 만듭니다.</p>
          ) : (
            <p>가상의 성도 800명과 헌금 20만 건(최근 3년, 주 750~2,000건, 매년 12/25·1/1은 하루 5,000건), 수정·삭제 이력 6건이 들어갑니다. 만드는 데 10초 안팎 걸립니다.</p>
          )}
          <p className="text-red-700">성도·헌금 데이터가 이미 있으면 만들 수 없습니다. 시연 데이터는 데이터가 없는 상태에서만 만들 수 있습니다.</p>
        </div>
      </Modal>

      <Modal
        open={s.removeDemoOpen && s.demoActive}
        onClose={s.cancelRemoveDemo}
        title="시연 데이터를 제거할까요?"
        description="시연 중에 수정·삭제·추가한 데이터를 포함해 지금 앱의 모든 데이터가 지워집니다."
        footer={
          <>
            <button className="btn" onClick={s.cancelRemoveDemo} disabled={s.busy}>
              취소
            </button>
            <button className="btn-danger" onClick={() => void s.confirmRemoveDemo()} disabled={s.busy}>
              {s.busy ? '제거하는 중…' : '시연 데이터 제거'}
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-red-700">시연 중에 새로 입력한 실제 데이터도 함께 삭제됩니다.</p>
          <p>제거하면 앱이 빈 상태(기본 헌금 종류)로 돌아갑니다. 되돌릴 수 없습니다.</p>
        </div>
      </Modal>

      <Modal
        open={s.resetOpen}
        onClose={s.cancelReset}
        title="전체 데이터를 초기화할까요?"
        description="성도, 헌금 내역, 수정·삭제 이력이 모두 삭제되고 헌금 종류는 기본값으로 돌아갑니다."
        footer={
          <>
            <button className="btn" onClick={s.cancelReset} disabled={s.busy}>
              취소
            </button>
            <button className="btn-danger" onClick={() => void s.confirmReset()} disabled={s.busy || s.resetLeft > 0}>
              {s.resetLeft > 0 ? `${s.resetLeft}초 후 초기화 가능` : '긴급 백업 후 초기화'}
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-red-700">이 작업은 되돌릴 수 없습니다.</p>
          <p>초기화 직전에 현재 데이터를 emergency_before_reset 파일로 백업 폴더에 저장합니다. 필요하면 나중에 [백업 파일 복원]으로 되살릴 수 있습니다.</p>
          <p className="text-gray-600">테마·백업 주기 같은 환경 설정은 유지됩니다.</p>
        </div>
      </Modal>

      <Modal
        open={!!s.restore}
        onClose={s.cancelRestore}
        title="백업 파일 복원할까요?"
        description="복원할 연도를 선택하세요."
        footer={
          <>
            <button className="btn" onClick={s.cancelRestore}>
              취소
            </button>
            <button className="btn-danger" onClick={() => void s.confirmRestore()} disabled={s.busy || !s.restoreYear}>
              복원
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p>
            파일: <b>{s.restore?.fileName}</b>
          </p>
          <p>{s.restore?.summary}</p>
          {s.restore?.mergeNotice ? <p className="rounded bg-blue-50 p-2 text-xs text-blue-800">{s.restore.mergeNotice}</p> : null}
          <div className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2">
            <label className="text-gray-600" htmlFor="restore-year">
              복원할 연도
            </label>
            <select id="restore-year" className="input w-44" value={s.restoreYear} onChange={(e) => s.setRestoreYear(e.target.value)} disabled={s.restoreYearOptions.length === 0}>
              {s.restoreYearOptions.length === 0 ? <option value="">연도 없음</option> : null}
              {s.restoreYearOptions.map((y) => (
                <option key={y.year} value={y.year}>
                  {y.year}년 ({y.count.toLocaleString('ko-KR')}건)
                </option>
              ))}
            </select>
          </div>
          <p className="text-gray-600">
            {s.restoreYearOptions.length === 0 ? (
              '이 백업 파일에는 복원할 헌금 내역(연도)이 없어 복원할 수 없습니다.'
            ) : (
              <>
                <b className="text-red-700 underline">선택한 연도</b>의 헌금과 수정·삭제 이력만 백업 내용으로 바뀝니다.<br/>다른 연도는 그대로이며, 성도·헌금 종류는 지우지 않고 백업에만 있는 항목을 추가합니다.
              </>
            )}
          </p>
          {s.restore?.migratedFrom ? <p className="text-amber-700">구버전(v{s.restore.migratedFrom}) 백업입니다. v2 형식으로 자동 변환됩니다.</p> : null}
          <p className="text-gray-600">무결성 검증을 통과했습니다.</p>
        </div>
      </Modal>
    </div>
  );
}
