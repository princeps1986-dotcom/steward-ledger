import type { DonationEditorController } from '../../../hooks/useDonationEditor';
import { DatePicker } from '../../shared/DatePicker';
import { Modal } from '../../shared/Modal';

export function DonationEditModal({ editor: e }: { editor: DonationEditorController }) {
  const d = e.draft;
  const isDelete = e.mode === 'DELETE';
  return (
    <Modal
      open={e.isOpen}
      overflowVisible
      onClose={e.close}
      title={isDelete ? '헌금 내역 삭제' : '헌금 내역 수정'}
      description={e.targetSummary}
      footer={
        <>
          <button className="btn" onClick={e.close}>
            취소
          </button>
          <button className={isDelete ? 'btn-danger' : 'btn-primary'} onClick={() => void e.submit()} disabled={e.busy}>
            {isDelete ? '삭제' : '수정 저장'}
          </button>
        </>
      }
    >
      {d ? (
        <div className="grid grid-cols-2 gap-3">
          {isDelete ? null : (
            <>
              <div>
                <span className="label">날짜</span>
                <DatePicker value={d.date} onChange={e.setField('date')} ariaLabel="헌금 날짜" pickOnly />
              </div>
              <label>
                <span className="label">헌금 종류</span>
                <select className="input" value={d.offeringTypeId} onChange={(ev) => e.setField('offeringTypeId')(ev.target.value)}>
                  {e.typeOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* 누구의 헌금인지(성도·표기명)는 바꿀 수 없습니다. 잘못 입력했다면 삭제 후 다시 입력하세요. */}
              <div>
                <span className="label">성도 · 표기명 (변경 불가)</span>
                <div className="input cursor-not-allowed bg-gray-50 text-gray-600" aria-readonly="true">
                  {e.donorLabel}
                </div>
              </div>
              <div />
              <label>
                <span className="label">금액</span>
                <input className="input text-right" inputMode="numeric" value={d.amount} onChange={(ev) => e.setField('amount')(ev.target.value)} />
              </label>
              <label>
                <span className="label">메모</span>
                <input className="input" value={d.memo} onChange={(ev) => e.setField('memo')(ev.target.value)} />
              </label>
              <p className="col-span-2 text-xs text-gray-500">날짜는 달력에서만 고를 수 있습니다. 다른 달·연도로 바꾸면 그 달 장부로 옮겨지고 수정·삭제 이력에 기록됩니다. 성도·표기명을 잘못 입력했다면 이 내역을 삭제하고 다시 입력하세요.</p>
            </>
          )}
          <label className="col-span-2">
            <span className="label">{isDelete ? '삭제' : '수정'} 사유 * (필수)</span>
            <input className="input" value={d.reason} onChange={(ev) => e.setField('reason')(ev.target.value)} autoFocus placeholder="예: 금액 오기입 정정" />
          </label>
          {e.error ? <p className="col-span-2 text-sm text-red-600">{e.error}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
