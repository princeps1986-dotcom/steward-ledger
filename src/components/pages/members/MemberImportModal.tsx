import { useMemberImport } from '../../../hooks/useMemberImport';
import { Modal } from '../../shared/Modal';
import { normalizePosition } from '../../../services/domain/positions';

const STATUS_COLOR = {
  OK: 'text-emerald-700',
  WARN: 'text-amber-700',
  ERROR: 'text-red-700',
  DUPLICATE: 'text-blue-700',
};

function ImportBody({ onClose }: { onClose(): void }) {
  const im = useMemberImport(onClose);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn cursor-pointer">
          파일 선택 (.csv / .xlsx)
          <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => void im.onFile(e)} />
        </label>
        <button className="btn" onClick={im.downloadTemplate}>
          양식 다운로드
        </button>
        <span className="text-sm text-gray-600">{im.fileName}</span>
      </div>
      <p className="text-xs text-gray-500">
        컬럼: 이름(필수), 직분, 생년월일(YYYY-MM-DD), 연락처뒷4자리, 세대주여부(Y/N), 세대주이름. CSV는 UTF-8과 한글 엑셀(CP949)을 자동 인식합니다.
      </p>
      {im.error ? <p className="text-sm text-red-600">{im.error}</p> : null}
      {im.stats ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          완료: 등록 {im.stats.created}건 / 건너뜀 {im.stats.skipped}건 / 덮어씀 {im.stats.overwritten}건 / 오류 {im.stats.errors}건
        </p>
      ) : null}

      {im.hasPreview ? (
        <>
          <p className="text-sm">
            정상 {im.summary.ok}건 · 중복 {im.summary.dup}건 · 오류 {im.summary.err}건 (오류 행은 가져오지 않습니다. 중복은 기본 건너뛰기이며, 덮어쓰기는 직분·생년월일·연락처만 갱신합니다.)
          </p>
          <div className="max-h-[50vh] overflow-auto rounded border">
            <table className="w-full">
              <thead className="sticky top-0">
                <tr>
                  <th className="th">행</th>
                  <th className="th">상태</th>
                  <th className="th">이름</th>
                  <th className="th">직분</th>
                  <th className="th">생년월일</th>
                  <th className="th">연락처</th>
                  <th className="th">세대주</th>
                  <th className="th">세대주이름</th>
                  <th className="th">메시지</th>
                  <th className="th">덮어쓰기</th>
                </tr>
              </thead>
              <tbody>
                {im.preview.map((r) => (
                  <tr key={r.rowNo}>
                    <td className="td">{r.rowNo}</td>
                    <td className={`td font-semibold ${STATUS_COLOR[r.status]}`}>{r.statusLabel}</td>
                    <td className="td">{r.name}</td>
                    <td className="td">{normalizePosition(r.position) || '-'}</td>
                    <td className="td">{r.birthDate}</td>
                    <td className="td">{r.phoneLast4}</td>
                    <td className="td">{r.isHead ? 'Y' : ''}</td>
                    <td className="td">{r.headName}</td>
                    <td className="td text-xs">{r.messages.join(' ')}</td>
                    <td className="td text-center">
                      {r.status === 'DUPLICATE' ? (
                        <input type="checkbox" checked={r.overwrite} onChange={() => im.toggleOverwrite(r.rowNo)} aria-label={`${r.rowNo}행 덮어쓰기`} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={im.close}>
          닫기
        </button>
        <button className="btn-primary" onClick={() => void im.confirm()} disabled={!im.hasPreview || im.busy}>
          가져오기 확정
        </button>
      </div>
    </div>
  );
}

export function MemberImportModal({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose} title="성도 명단 가져오기" widthClass="max-w-5xl">
      {open ? <ImportBody onClose={onClose} /> : null}
    </Modal>
  );
}
