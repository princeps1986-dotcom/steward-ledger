import { useState, type KeyboardEvent } from 'react';
import { useMemberImport } from '../../../hooks/useMemberImport';
import { usePaging } from '../../../hooks/usePaging';
import { Modal } from '../../shared/Modal';
import { Pager } from '../../shared/Pager';
import { normalizePosition, positionOptions } from '../../../services/domain/positions';

const PAGE_SIZE = 100;

const STATUS_COLOR = {
  OK: 'text-emerald-700',
  WARN: 'text-amber-700',
  ERROR: 'text-red-700',
  DUPLICATE: 'text-blue-700',
};

function ImportBody({ onClose }: { onClose(): void }) {
  const im = useMemberImport(onClose);
  const paging = usePaging(im.preview.length, PAGE_SIZE, String(im.loadId));
  // 한 번에 한 행만 고칩니다.
  const [editing, setEditing] = useState<{ rowNo: number; name: string; position: string; phoneLast4: string } | null>(null);
  const saveEdit = () => {
    if (!editing) return;
    im.updateRow(editing.rowNo, editing);
    setEditing(null);
  };
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
      <textarea
        className="w-full resize-none rounded border border-dashed px-3 py-2 text-sm"
        rows={1}
        readOnly
        disabled={im.busy}
        value=""
        aria-label="성도 명단 표 붙여넣기"
        placeholder="또는 여기를 누르고 이름 열을 붙여넣기(Ctrl+V) — 첫 줄은 제목(이름·성명·성도명·성도), 이름만 읽습니다"
        onPaste={(e) => {
          e.preventDefault();
          void im.onPaste(e.clipboardData.getData('text/plain'));
        }}
      />
      <p className="text-xs text-gray-500">
        컬럼: 이름(필수), 직분, 연락처뒷4자리, 대표자여부(Y/N), 대표자이름
      </p>
      {im.error ? <p className="text-sm text-red-600">{im.error}</p> : null}
      {im.stats ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          완료: 등록 {im.stats.created}건 / 건너뜀 {im.stats.skipped}건 / 덮어씀 {im.stats.overwritten}건 / 오류 {im.stats.errors}건
          {im.removed > 0 ? ` / 제외 ${im.removed}건` : ''}
        </p>
      ) : null}

      {im.hasPreview ? (
        <>
          <p className="text-sm">
            정상 {im.summary.ok}건 · 중복 {im.summary.dup}건 · 오류 {im.summary.err}건 (오류 행은 가져오지 않습니다. 중복은 기본 건너뛰기이며, 덮어쓰기는 직분·연락처만 갱신합니다.)
          </p>
          <div ref={paging.scrollRef} className="max-h-[50vh] overflow-auto rounded border">
            <table className="w-full whitespace-nowrap">
              <thead className="sticky top-0">
                <tr>
                  <th className="th">행</th>
                  <th className="th">상태</th>
                  <th className="th">이름</th>
                  <th className="th">직분</th>
                  <th className="th">연락처</th>
                  <th className="th">대표자</th>
                  <th className="th">대표자이름</th>
                  <th className="th">메시지</th>
                  <th className="th">덮어쓰기</th>
                  <th className="th">관리</th>
                </tr>
              </thead>
              <tbody>
                {im.preview.slice(paging.from, paging.to).map((r) => {
                  const edit = editing?.rowNo === r.rowNo ? editing : null;
                  const keys = (e: KeyboardEvent) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') setEditing(null);
                  };
                  // 직분·연락처는 성도 수정 창(MemberFormFields)과 같은 방식으로 받습니다.
                  const nameField = edit ? (
                    <input className="input w-24 px-1 py-0.5" aria-label={`${r.rowNo}행 이름`} value={edit.name} onChange={(e) => setEditing({ ...edit, name: e.target.value })} onKeyDown={keys} />
                  ) : null;
                  const positionField = edit ? (
                    <select className="input w-24 px-1 py-0.5" aria-label={`${r.rowNo}행 직분`} value={edit.position} onChange={(e) => setEditing({ ...edit, position: e.target.value })} onKeyDown={keys}>
                      <option value="">미선택</option>
                      {positionOptions(edit.position).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : null;
                  const phoneField = edit ? (
                    <input
                      className="input w-16 px-1 py-0.5"
                      inputMode="numeric"
                      aria-label={`${r.rowNo}행 연락처`}
                      value={edit.phoneLast4}
                      onChange={(e) => setEditing({ ...edit, phoneLast4: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
                      onKeyDown={keys}
                    />
                  ) : null;
                  return (
                    <tr key={r.rowNo}>
                      <td className="td">{r.rowNo}</td>
                      <td className={`td font-semibold ${STATUS_COLOR[r.status]}`}>{r.statusLabel}</td>
                      <td className="td">{nameField ?? r.name}</td>
                      <td className="td">{positionField ?? (normalizePosition(r.position) || '-')}</td>
                      <td className="td">{phoneField ?? r.phoneLast4}</td>
                      <td className="td">{r.isHead ? 'Y' : ''}</td>
                      <td className="td">{r.headName}</td>
                      <td className="td min-w-[14rem] whitespace-normal text-xs">{r.messages.join(' ')}</td>
                      <td className="td text-center">
                        {/* 이름만 있는 중복 행은 덮어쓸 직분·연락처가 없으므로 칸을 숨깁니다. */}
                        {r.status === 'DUPLICATE' && (r.position || r.phoneLast4) ? (
                          <input type="checkbox" checked={r.overwrite} onChange={() => im.toggleOverwrite(r.rowNo)} aria-label={`${r.rowNo}행 덮어쓰기`} />
                        ) : null}
                      </td>
                      <td className="td whitespace-nowrap text-right">
                        {edit ? (
                          <span className="flex justify-end gap-1">
                            <button className="btn px-2 py-0.5 text-xs" onClick={saveEdit} disabled={!edit.name.trim()}>
                              확인
                            </button>
                            <button className="btn px-2 py-0.5 text-xs" onClick={() => setEditing(null)}>
                              취소
                            </button>
                          </span>
                        ) : (
                          <span className="flex justify-end gap-1">
                            <button
                              className="btn px-2 py-0.5 text-xs"
                              aria-label={`${r.rowNo}행 수정`}
                              disabled={im.busy}
                              onClick={() => setEditing({ rowNo: r.rowNo, name: r.name, position: normalizePosition(r.position), phoneLast4: r.phoneLast4 })}
                            >
                              수정
                            </button>
                            <button className="btn px-2 py-0.5 text-xs" aria-label={`${r.rowNo}행 제외`} disabled={im.busy} onClick={() => im.removeRow(r.rowNo)}>
                              제외
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager paging={paging} />
        </>
      ) : null}

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={im.close}>
          닫기
        </button>
        <button className="btn-primary" onClick={() => void im.confirm()} disabled={!im.hasPreview || im.busy || !!editing}>
          불러오기 확정
        </button>
      </div>
    </div>
  );
}

export function MemberImportModal({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose} title="성도 명단 불러오기" widthClass="max-w-5xl">
      {open ? <ImportBody onClose={onClose} /> : null}
    </Modal>
  );
}
