import { allowed } from '../../../services/auth/access';
import { ConfirmFooter } from '../../shared/ConfirmFooter';
import { Modal } from '../../shared/Modal';
import type { useSettingsPage } from '../../../hooks/useSettingsPage';

type Props = { s: ReturnType<typeof useSettingsPage> };

/** 시연 데이터 생성·제거와 전체 초기화(위험 영역과 확인 창). 상태와 동작은 useDemoAndReset.ts */
export function DemoResetSection({ s }: Props) {
  return (
    <>
      {/* 현재 데이터를 지우거나 통째로 바꾸는 동작은 일반 백업·복원과 떨어뜨려 경고와 함께 둡니다. */}
      {allowed('data:reset') ? (
      <section className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4" aria-labelledby="danger-zone-title">
        <h3 id="danger-zone-title" className="flex items-center gap-1.5 font-semibold text-red-700">
          <span aria-hidden="true">⚠</span> 시연 데이터 생성 · 삭제
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
      ) : null}

      <Modal
        open={s.demoOpen}
        onClose={s.cancelDemo}
        title="시연 데이터를 생성할까요?"
        description="가상의 시연 데이터가 만들어집니다. 시연이 끝나면 [시연 데이터 제거]로 초기화 할 수 있습니다."
        footer={
          <ConfirmFooter
            onCancel={s.cancelDemo}
            onConfirm={s.confirmDemo}
            tone="danger"
            busy={s.busy}
            confirmDisabled={s.hasMembersOrDonations}
            confirmLabel={s.demoProgress ? `만드는 중… ${s.demoProgress.done}/${s.demoProgress.total}` : '시연 데이터 생성'}
          />
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
          <ConfirmFooter onCancel={s.cancelRemoveDemo} onConfirm={s.confirmRemoveDemo} tone="danger" busy={s.busy} confirmLabel={s.busy ? '제거하는 중…' : '시연 데이터 제거'} />
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-red-700">시연 중에 새로 입력한 실제 데이터도 함께 삭제됩니다.</p>
          <p>제거하면 데이터가 초기상태로 돌아갑니다.</p>
        </div>
      </Modal>

      <Modal
        open={s.resetOpen}
        onClose={s.cancelReset}
        title="전체 데이터를 초기화할까요?"
        footer={
          <ConfirmFooter
            onCancel={s.cancelReset}
            onConfirm={s.confirmReset}
            tone="danger"
            busy={s.busy}
            confirmDisabled={s.resetLeft > 0}
            confirmLabel={s.resetLeft > 0 ? `${s.resetLeft}초 후 초기화 가능` : '초기화'}
          />
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-md border-2 border-red-600 bg-red-50 p-3 text-red-900">
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><b>성도</b>, <b>헌금 내역</b>, <b>수정·삭제 이력</b>이 모두 삭제됩니다.</li>
              <li>잠긴 연도도 모두 지워집니다.</li>
              <li><b>헌금 종류</b>는 <b>기본값</b>으로 돌아갑니다. 환경 설정은 유지됩니다.</li>
            </ul>
          </div>
          <div className="rounded-md border border-gray-300 p-3">
            {s.hasFullBackup ? (
              <>
                <p>마지막 전체 백업 시각: <b>{s.lastBackupLabel}</b></p>
                <p className="mt-1">[백업 파일 복원]으로 <b>복구</b>할 수 있습니다.</p>
              </>
            ) : (
              <p><b className="text-red-700">전체 백업 파일이 없습니다.</b> 초기화하면 지금 데이터를 <b className="text-red-700">복구할 수 없습니다</b>. 먼저 [백업 파일 저장]으로 백업하세요.</p>
            )}
          </div>
          {s.isDesktop ? (
            <p className="text-xs text-gray-500">전체 백업은 마지막 전체 백업 이후 바뀐 내용이 있으면 앱을 닫을 때 자동으로 저장됩니다(이 PC에서만 복원 가능). 사용 중 10분마다 저장되는 자동 백업은 바뀐 연도만 담습니다.</p>
          ) : null}
        </div>
      </Modal>

    </>
  );
}
