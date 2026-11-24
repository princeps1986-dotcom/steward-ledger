import { useDonationImport } from '../../../hooks/useDonationImport';
import { Modal } from '../../shared/Modal';
import { DatePicker } from '../../shared/DatePicker';

const STATUS_COLOR = {
  OK: 'text-emerald-700',
  WARN: 'text-amber-700',
  ERROR: 'text-red-700',
  SAVED: 'text-blue-700',
} as const;

function ImportBody({ onClose, initialDate }: { onClose(): void; initialDate: string }) {
  const im = useDonationImport(onClose, initialDate);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn cursor-pointer">
          파일 선택 (.csv)
          <input type="file" accept=".csv" className="hidden" onChange={(e) => void im.onFile(e)} />
        </label>
        <button className="btn" onClick={im.downloadTemplate}>
          양식 다운로드
        </button>
        <span className="text-sm text-gray-600">{im.fileName}</span>
      </div>
      <p className="text-xs text-gray-500">
        컬럼: 날짜(YYYY-MM-DD, 없으면 아래에서 고른 날짜), 성도이름(필수), 연락처뒷4자리(동명이인일 때 필수), 헌금종류(필수, 헌금 종류 화면의 이름과 같아야 함), 금액(필수), 메모.
        성도와 헌금 종류는 미리 등록해 두어야 합니다.
      </p>
      {im.error ? <p className="text-sm text-red-600">{im.error}</p> : null}
      {im.result ? <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{im.result}</p> : null}

      {im.hasPreview && !im.hasDateColumn ? (
        <div className="flex items-center gap-2">
          <span className="label mb-0">이 파일의 날짜</span>
          <DatePicker value={im.defaultDate} onChange={im.setDefaultDate} ariaLabel="불러올 헌금 날짜" />
        </div>
      ) : null}

      {im.hasPreview ? (
        <>
          {im.summary.err > 0 ? (
            <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              오류 {im.summary.err}건 — 저장할 수 없습니다. 아래 오류 메시지를 보고 파일이나 성도·헌금 종류를 고친 뒤 다시 불러오세요.
            </p>
          ) : null}
          <p className="text-sm">
            저장 {im.summary.save}건 · 이미 저장됨 {im.summary.saved}건 · 확인 {im.summary.warn}건 · 오류 {im.summary.err}건
          </p>
          <div className="max-h-[50vh] overflow-auto rounded border">
            <table className="w-full">
              <thead className="sticky top-0">
                <tr>
                  <th className="th">행</th>
                  <th className="th">상태</th>
                  <th className="th">날짜</th>
                  <th className="th">성도</th>
                  <th className="th">헌금 종류</th>
                  <th className="th">금액</th>
                  <th className="th">메모</th>
                  <th className="th">메시지</th>
                </tr>
              </thead>
              <tbody>
                {im.preview.map((r) => (
                  <tr key={r.rowNo}>
                    <td className="td">{r.rowNo}</td>
                    <td className={`td font-semibold ${STATUS_COLOR[r.status]}`}>{r.statusLabel}</td>
                    <td className="td">{r.draft?.date ?? r.date}</td>
                    <td className="td">{r.name}</td>
                    <td className="td">{r.typeName}</td>
                    <td className="td text-right">{r.amountRaw ? Number(r.amountRaw).toLocaleString('ko-KR') : ''}</td>
                    <td className="td">{r.memo}</td>
                    <td className="td text-xs">{r.messages.join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {im.largeCount > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={im.largeConfirmed} onChange={(e) => im.setLargeConfirmed(e.target.checked)} />
              큰 금액 {im.largeCount}건을 확인했습니다.
            </label>
          ) : null}
        </>
      ) : null}

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={im.close}>
          닫기
        </button>
        <button className="btn-primary" onClick={() => void im.confirm()} disabled={!im.canSave}>
          {im.busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

/** 일별 보고서에서 여는 CSV 불러오기. initialDate는 보고서가 보고 있는 날짜(날짜 열이 없을 때 기본값). */
export function DonationImportModal({ open, onClose, initialDate }: { open: boolean; onClose(): void; initialDate: string }) {
  return (
    <Modal open={open} onClose={onClose} title="헌금 CSV 불러오기" widthClass="max-w-5xl">
      {open ? <ImportBody onClose={onClose} initialDate={initialDate} /> : null}
    </Modal>
  );
}
