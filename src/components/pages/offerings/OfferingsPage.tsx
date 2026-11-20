import { useOfferingsPage } from '../../../hooks/useOfferingsPage';
import { Modal } from '../../shared/Modal';
import { ConfirmFooter } from '../../shared/ConfirmFooter';

export function OfferingsPage() {
  const p = useOfferingsPage();
  const f = p.form;
  return (
    <div className="space-y-4">
      <section className="card flex items-center justify-between">
        <p className="text-sm text-gray-600">
          '기본 나열'은 입력 화면에 항상 표시되고, '기타 드롭다운'은 선택해서 입력합니다. 행을 끌어서 순서를 바꿀 수 있습니다.
        </p>
        <button className="btn-primary shrink-0 whitespace-nowrap" onClick={p.openNew}>
          + 헌금 종류 추가
        </button>
      </section>
      <section className="card overflow-x-auto p-0">
        <table className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th className="th">순서</th>
              <th className="th sticky left-0 z-10">헌금 명칭</th>
              <th className="th">노출 영역</th>
              <th className="th">자주 쓰는 금액 단추</th>
              <th className="th">상태</th>
              <th className="th text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map(({ type: t, areaLabel, quickLabel }) => (
              <tr
                key={t.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id); // Firefox는 데이터가 있어야 끌기가 시작됩니다.
                  p.startDrag(t.id);
                }}
                onDragOver={(e) => {
                  if (!p.dragId) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  p.overRow({ id: t.id, after: e.clientY > r.top + r.height / 2 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  p.dropRow();
                }}
                onDragEnd={p.endDrag}
                className={`${t.isActive ? '' : 'text-gray-400'} ${p.dragId === t.id ? 'opacity-40' : ''} ${p.dragId && p.drop?.id === t.id && p.dragId !== t.id ? (p.drop.after ? 'shadow-[inset_0_-2px_0_#2563eb]' : 'shadow-[inset_0_2px_0_#2563eb]') : ''}`}
              >
                <td className="td cursor-grab select-none" title="끌어서 순서 바꾸기">
                  <svg aria-hidden="true" viewBox="0 0 12 18" width="12" height="18" className="mr-1.5 inline-block align-middle text-gray-500">
                    {[3, 9, 15].map((y) => (
                      <g key={y} fill="currentColor">
                        <circle cx="3" cy={y} r="1.6" />
                        <circle cx="9" cy={y} r="1.6" />
                      </g>
                    ))}
                  </svg>
                  {t.sortOrder}
                </td>
                <td className="td sticky left-0 bg-white font-medium">{t.name}</td>
                <td className="td">{areaLabel}</td>
                <td className="td">{quickLabel}</td>
                <td className="td">{t.isActive ? '활성' : '비활성'}</td>
                <td className="td text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn px-2 py-1 text-xs" onClick={() => p.openEdit(t)}>
                      수정
                    </button>
                    <button className="btn px-2 py-1 text-xs" onClick={() => p.toggleActive(t)}>
                      {t.isActive ? '비활성화' : '활성화'}
                    </button>
                    <button className="btn px-2 py-1 text-xs text-red-600" onClick={() => void p.askDelete(t)}>
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Modal
        open={!!p.notice}
        onClose={p.closeNotice}
        title={p.notice?.title ?? ''}
        description={p.notice?.body}
        footer={
          <button className="btn-primary" autoFocus onClick={p.closeNotice}>
            확인
          </button>
        }
      >
        <span className="sr-only">안내</span>
      </Modal>

      <Modal
        open={!!p.confirming}
        onClose={p.cancelDelete}
        title={`'${p.confirming?.name ?? ''}' 헌금 종류를 삭제할까요?`}
        description="입력된 헌금이 없는 헌금 종류입니다. 삭제하면 되돌릴 수 없습니다."
        footer={
          <ConfirmFooter onCancel={p.cancelDelete} onConfirm={p.confirmDelete} tone="danger" autoFocus confirmLabel="삭제" />
        }
      >
        <span className="sr-only">삭제 확인</span>
      </Modal>

      <Modal open={!!f} onClose={p.close} title={f?.id ? '헌금 종류 수정' : '헌금 종류 추가'}>
        {f ? (
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void p.submit();
            }}
          >
            <label className="col-span-2">
              <span className="label">헌금 명칭 *</span>
              <input className="input" value={f.name} onChange={(e) => p.setField('name')(e.target.value)} autoFocus />
            </label>
            <label>
              <span className="label">노출 영역</span>
              <select className="input" value={f.displayArea} onChange={(e) => p.setField('displayArea')(e.target.value as 'PRIMARY' | 'DROPDOWN')}>
                <option value="PRIMARY">기본 나열</option>
                <option value="DROPDOWN">기타 드롭다운</option>
              </select>
            </label>
            <label>
              <span className="label">정렬 순서</span>
              <input className="input" inputMode="numeric" value={f.sortOrder} onChange={(e) => p.setField('sortOrder')(e.target.value)} />
            </label>
            <label className="col-span-2">
              <span className="label">자주 쓰는 금액 단추 ('/'로 구분)</span>
              <input
                className="input"
                value={f.quickAmountsText}
                onChange={(e) => p.setField('quickAmountsText')(e.target.value)}
                placeholder="예: 100,000 / 200,000 / 500,000"
              />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.isActive} onChange={(e) => p.setField('isActive')(e.target.checked)} />
              활성 (비활성 시 신규 입력에서 제외, 과거 통계는 유지)
            </label>
            {p.error ? <p className="col-span-2 text-sm text-red-600">{p.error}</p> : null}
            <div className="col-span-2 flex justify-end gap-2">
              <button type="button" className="btn" onClick={p.close}>
                취소
              </button>
              <button type="submit" className="btn-primary">
                저장
              </button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
