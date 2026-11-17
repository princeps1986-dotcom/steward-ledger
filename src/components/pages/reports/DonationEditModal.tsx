import { useEffect, useRef, useState } from 'react';
import type { DonationEditorController } from '../../../hooks/useDonationEditor';
import { DatePicker } from '../../shared/DatePicker';
import { Modal } from '../../shared/Modal';

const OTHER = '기타(직접 입력)';
/** 자주 쓰는 사유. 고르면 입력 칸에 채워지고 그대로 고쳐 쓸 수 있습니다. */
const EDIT_REASONS = ['금액 오기입', '헌금 종류 오기입', '날짜 오기입', '메모 수정', OTHER];
const DELETE_REASONS = ['중복 입력 삭제', '성도 잘못 선택(삭제 후 다시 입력)', '금액 오기입(삭제 후 다시 입력)', OTHER];

export function DonationEditModal({ editor: e }: { editor: DonationEditorController }) {
  const d = e.draft;
  const isDelete = e.mode === 'DELETE';
  const reasonRef = useRef<HTMLInputElement>(null);
  const reasonMissing = !!e.error?.startsWith('사유');
  // 목록에서 고른 문구. 입력 칸의 글자가 이것과 다르면(직접 쓴 경우) 목록은 "기타"로 바뀌고 잠깁니다.
  const [picked, setPicked] = useState('');
  useEffect(() => setPicked(''), [e.isOpen]);
  const reason = d?.reason ?? '';
  const manual = reason !== '' && reason !== picked;
  const reasonSelect = manual ? OTHER : reason === '' && picked !== OTHER ? '' : picked;
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
              {/* 누구의 헌금인지(성도·표기명)는 바꿀 수 없습니다. 잘못 입력했다면 삭제 후 다시 입력하세요. */}
              <div className="col-span-2">
                <span className="label">성도 · 표기명 (변경 불가)</span>
                <div className="input flex cursor-not-allowed items-center justify-between gap-2 bg-gray-50 text-gray-600" aria-readonly="true">
                  <span className="truncate">{e.donorLabel}</span>
                  {e.donorHousehold ? <span className="whitespace-nowrap rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">{e.donorHousehold}</span> : null}
                </div>
              </div>
              <div>
                <span className="label">날짜</span>
                <DatePicker value={d.date} onChange={e.setField('date')} ariaLabel="헌금 날짜" />
              </div>
              <label>
                <span className="label">헌금 종류</span>
                <select className="input" value={d.offeringTypeId} onChange={(ev) => e.setField('offeringTypeId')(ev.target.value)}>
                  {e.typeOptions.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.disabled}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">금액</span>
                <input className="input text-right" inputMode="numeric" value={d.amount} onChange={(ev) => e.setField('amount')(ev.target.value)} />
              </label>
              <label>
                <span className="label">메모</span>
                <input className="input" value={d.memo} onChange={(ev) => e.setField('memo')(ev.target.value)} />
              </label>
              <p className="col-span-2 text-xs text-gray-500">날짜를 바꾸면 바꾼 날짜 기준으로 집계됩니다. 성도·표기명을 잘못 입력했다면 삭제 후 다시 입력하세요.</p>
            </>
          )}
          <div className="col-span-2 rounded border border-red-300 bg-red-50 p-3">
            <span className="label text-sm">
              {isDelete ? '삭제' : '수정'} 사유 <span className="font-semibold text-red-600">* 필수</span>
            </span>
            <select
              className="input mb-2"
              aria-label="자주 쓰는 사유 선택"
              value={reasonSelect}
              disabled={manual}
              onChange={(ev) => {
                const v = ev.target.value;
                setPicked(v);
                e.setField('reason')(v === OTHER ? '' : v);
                if (v) reasonRef.current?.focus();
              }}
            >
              <option value="">자주 쓰는 사유에서 고르기</option>
              {(isDelete ? DELETE_REASONS : EDIT_REASONS).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              ref={reasonRef}
              className={`input ${reasonMissing ? 'border-red-500 ring-2 ring-red-200' : ''}`}
              value={d.reason}
              onChange={(ev) => {
                e.setField('reason')(ev.target.value);
                if (ev.target.value === '') setPicked(''); // 모두 지우면 목록을 다시 쓸 수 있음
              }}
              autoFocus
              aria-label={`${isDelete ? '삭제' : '수정'} 사유`}
              aria-invalid={reasonMissing}
              onBlur={(ev) => {
                const t = ev.target.value.trim(); // 양 옆 공백 제거
                if (t !== ev.target.value) e.setField('reason')(t);
              }}
              placeholder="직접 입력할 수도 있습니다. (한글 4글자 이상)"
            />
            <p className="mt-1 text-xs text-gray-600">목록에서 선택하거나 직접 입력하세요. 입력한 사유는 수정·삭제 이력에 남습니다.</p>
          </div>
          {e.error ? <p className="col-span-2 text-sm text-red-600">{e.error}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
