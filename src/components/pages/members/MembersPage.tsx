import { useMembersPage } from '../../../hooks/useMembersPage';
import type { MemberSortKey } from '../../../services/domain/memberSort';
import { Modal } from '../../shared/Modal';
import { Notice } from '../../shared/Notice';
import { MemberEditModal } from './MemberEditModal';
import { MemberImportModal } from './MemberImportModal';
import { normalizePosition } from '../../../services/domain/positions';

const COLUMNS: { key: MemberSortKey; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'position', label: '직분' },
  { key: 'phoneLast4', label: '연락처 뒷4자리' },
  { key: 'family', label: '세대' },
];

/** 정렬 가능한 열임을 항상 보여 주는 표시: 현재 기준 열은 ▲/▼(진하게), 나머지는 ↕(연하게) */
function SortMark({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span aria-hidden="true" className={`ml-1 text-[10px] ${active ? 'text-blue-600' : 'text-gray-300'}`}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  );
}

export function MembersPage() {
  const p = useMembersPage();
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
      <section className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th w-12 text-center">No</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="th" aria-sort={p.sort.key === c.key ? (p.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="font-semibold hover:text-blue-700" onClick={() => p.toggleSort(c.key)} title="누르면 이 열 기준으로 정렬합니다">
                    {c.label}
                    <SortMark active={p.sort.key === c.key} dir={p.sort.dir} />
                  </button>
                </th>
              ))}
              <th className="th">세대주</th>
              <th className="th" aria-sort={p.sort.key === 'state' ? (p.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="font-semibold hover:text-blue-700" onClick={() => p.toggleSort('state')} title="누르면 이 열 기준으로 정렬합니다">
                  상태
                  <SortMark active={p.sort.key === 'state'} dir={p.sort.dir} />
                </button>
              </th>
              <th className="th text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map(({ member: m, familyLabel, stateLabel }, i) => (
              <tr key={m.id} className={m.isActive ? '' : 'text-gray-400'}>
                <td className="td text-center text-xs text-gray-500">{i + 1}</td>
                <td className="td font-medium">{m.name}</td>
                <td className="td">{normalizePosition(m.position) || '-'}</td>
                <td className="td">{m.phoneLast4 ?? '-'}</td>
                <td className="td">{familyLabel}</td>
                <td className="td">{m.isFamilyHead ? '●' : ''}</td>
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
                <td className="td text-center text-gray-500" colSpan={8}>
                  성도가 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {p.editor ? <MemberEditModal key={p.editor.key} editor={p.editor} onClose={p.closeEditor} onSaved={p.onSaved} /> : null}
      <MemberImportModal open={p.importOpen} onClose={p.closeImport} />
      <Modal
        open={!!p.confirming}
        onClose={p.cancelToggleActive}
        title={p.confirmingText?.title ?? ''}
        description={p.confirmingText?.body}
        footer={
          <>
            <button className="btn" onClick={p.cancelToggleActive}>
              취소
            </button>
            <button className="btn-primary" autoFocus onClick={() => void p.confirmToggleActive()}>
              {p.confirmingText?.ok}
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {p.confirming?.name}{normalizePosition(p.confirming?.position) ? ` · ${normalizePosition(p.confirming?.position)}` : ''}
        </p>
      </Modal>
    </div>
  );
}
