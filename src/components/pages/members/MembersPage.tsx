import { useMembersPage } from '../../../hooks/useMembersPage';
import { usePaging } from '../../../hooks/usePaging';
import type { MemberSortKey } from '../../../services/domain/memberSort';
import { Modal } from '../../shared/Modal';
import { Notice } from '../../shared/Notice';
import { Pager } from '../../shared/Pager';
import { PAGER_RESERVE, REPORT_SCROLL, useFitHeight } from '../reports/reportScroll';
import { MemberEditModal } from './MemberEditModal';
import { MemberImportModal } from './MemberImportModal';
import { normalizePosition } from '../../../services/domain/positions';
import { ConfirmFooter } from '../../shared/ConfirmFooter';

const PAGE_SIZE = 100;

const COLUMNS: { key: MemberSortKey; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'position', label: '직분' },
  { key: 'phoneLast4', label: '연락처 뒷4자리' },
  { key: 'family', label: '세대' },
];

/** 누르면 정렬하는 머리글. 정렬 가능한 열임을 항상 보여 줍니다: 현재 기준 열은 ▲/▼(진하게), 나머지는 ↕(연하게) */
function SortTh({ sortKey, label, className, sort, onSort }: { sortKey: MemberSortKey; label: string; className: string; sort: { key: MemberSortKey; dir: 'asc' | 'desc' }; onSort(key: MemberSortKey): void }) {
  const active = sort.key === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="font-semibold hover:text-blue-700" onClick={() => onSort(sortKey)} title="누르면 이 열 기준으로 정렬합니다">
        {label}
        <span aria-hidden="true" className={`ml-1 text-[10px] ${active ? 'text-blue-600' : 'text-gray-300'}`}>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

export function MembersPage() {
  const p = useMembersPage();
  const paging = usePaging(p.rows.length, PAGE_SIZE, `${p.query}|${p.showInactive}|${p.sort.key}|${p.sort.dir}`);
  const fit = useFitHeight(paging.scrollRef, PAGER_RESERVE); // 표 안에서 스크롤해 머리글을 항상 보이게 합니다.
  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-end gap-3">
        <label className="w-72">
          <span className="label">검색 (이름·연락처 뒷자리)</span>
          <input className="input" value={p.query} onChange={(e) => p.setQuery(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={p.showInactive} onChange={(e) => p.setShowInactive(e.target.checked)} />
          비활성 성도 포함
        </label>
        <div className="flex-1" />
        <span className="pb-2 text-sm text-gray-500">활성 성도 {p.total}명</span>
        <button className="btn" onClick={p.openImport}>
          명단 가져오기
        </button>
        <button className="btn-primary" onClick={p.openNew}>
          + 성도 등록
        </button>
      </section>
      <Notice message={p.message} />
      <section ref={paging.scrollRef} style={fit} className={`card p-0 ${REPORT_SCROLL}`}>
        <table className="w-full whitespace-nowrap">
          <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
            <tr>
              <th className="th w-12 text-center">No</th>
              {COLUMNS.map((c) => (
                <SortTh key={c.key} sortKey={c.key} label={c.label} className={c.key === 'phoneLast4' ? 'th text-center' : c.key === 'name' ? 'th !left-0 !z-20' : 'th'} sort={p.sort} onSort={p.toggleSort} />
              ))}
              <th className="th text-center">세대주</th>
              <th className="th">등록일</th>
              <SortTh sortKey="state" label="상태" className="th" sort={p.sort} onSort={p.toggleSort} />
              <th className="th text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.slice(paging.from, paging.to).map(({ member: m, familyLabel, stateLabel, registeredLabel }, k) => (
              <tr key={m.id} className={m.isActive ? '' : 'text-gray-400'}>
                <td className="td text-center text-xs text-gray-500">{paging.from + k + 1}</td>
                <td className="td sticky left-0 bg-white font-medium">{m.name}</td>
                <td className="td">{normalizePosition(m.position) || '-'}</td>
                <td className="td text-center">{m.phoneLast4 ?? '-'}</td>
                <td className="td">{familyLabel}</td>
                <td className="td text-center">{m.isFamilyHead ? '●' : ''}</td>
                <td className="td">{registeredLabel}</td>
                <td className="td">{stateLabel}</td>
                <td className="td text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn px-2 py-1 text-xs" onClick={() => p.openEdit(m)}>
                      수정
                    </button>
                    <button className="btn px-2 py-1 text-xs" onClick={() => p.askToggleActive(m)}>
                      {m.isActive ? '비활성화' : '복구'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {p.rows.length === 0 ? (
              <tr>
                <td className="td text-center text-gray-500" colSpan={9}>
                  성도가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      <Pager paging={paging} unit="명" />
      {p.editor ? <MemberEditModal key={p.editor.key} editor={p.editor} onClose={p.closeEditor} onSaved={p.onSaved} /> : null}
      <MemberImportModal open={p.importOpen} onClose={p.closeImport} />
      <Modal
        open={!!p.confirming}
        onClose={p.cancelToggleActive}
        title={p.confirmingText?.title ?? ''}
        description={p.confirmingText?.body}
        footer={
          <ConfirmFooter onCancel={p.cancelToggleActive} onConfirm={p.confirmToggleActive} autoFocus confirmLabel={p.confirmingText?.ok} />
        }
      >
        <p className="text-sm text-gray-600">
          {p.confirming?.name}{normalizePosition(p.confirming?.position) ? ` · ${normalizePosition(p.confirming?.position)}` : ''}
        </p>
      </Modal>
    </div>
  );
}
