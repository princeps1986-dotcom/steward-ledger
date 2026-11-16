import type { DonationEditorController } from '../../../hooks/useDonationEditor';
import { DatePicker } from '../../shared/DatePicker';
import { Modal } from '../../shared/Modal';

export function DonationEditModal({ editor: e }: { editor: DonationEditorController }) {
  const d = e.draft;
  const isDelete = e.mode === 'DELETE';
  return (
    <Modal
      open={e.isOpen}
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
                <DatePicker value={d.date} onChange={e.setField('date')} ariaLabel="헌금 날짜" inline />
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
              <label>
                <span className="label">성도</span>
                <select className="input" value={d.memberId} onChange={(ev) => e.setField('memberId')(ev.target.value)}>
                  <option value="">무명/방문자</option>
                  {e.memberOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {d.memberId === '' ? (
                <label>
                  <span className="label">표기명</span>
                  <input className="input" value={d.donorDisplayName} onChange={(ev) => e.setField('donorDisplayName')(ev.target.value)} />
                </label>
              ) : (
                <div />
              )}
              <label>
                <span className="label">금액</span>
                <input className="input text-right" inputMode="numeric" value={d.amount} onChange={(ev) => e.setField('amount')(ev.target.value)} />
              </label>
              <label>
                <span className="label">메모</span>
                <input className="input" value={d.memo} onChange={(ev) => e.setField('memo')(ev.target.value)} />
              </label>
              <p className="col-span-2 text-xs text-gray-500">날짜를 다른 연도로 바꾸면 해당 연도 장부로 이관되고 감사 로그에 기록됩니다.</p>
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
