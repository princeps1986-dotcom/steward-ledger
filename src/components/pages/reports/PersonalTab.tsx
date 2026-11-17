import { useDonationEditor } from '../../../hooks/useDonationEditor';
import { useNameTag } from '../../../hooks/useNameTag';
import { usePaging } from '../../../hooks/usePaging';
import { usePersonalReport, type ReportFilters } from '../../../hooks/useReports';
import { formatWon } from '../../../services/domain/amount';
import { MemberPicker } from '../../shared/MemberPicker';
import { Pager } from '../../shared/Pager';
import { DonationEditModal } from './DonationEditModal';
import { NameWithTag } from './NameWithTag';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 40;
const GRID = 'grid grid-cols-[110px_1fr_140px_130px_1fr_120px] items-center';

export function PersonalTab({ f }: { f: ReportFilters }) {
  const r = usePersonalReport(f);
  const tagOf = useNameTag();
  const editor = useDonationEditor();
  const paging = usePaging(r.rows.length, PAGE_SIZE, `${r.selectedId}|${r.mode}|${f.label}`);

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <span className="label">성도 검색 (비활성 성도 포함)</span>
          <MemberPicker options={r.options} value={r.selectedId ?? ''} onChange={r.select} ariaLabel="성도 검색" placeholder="이름·연락처 뒷자리 (↑↓ 이동 · Enter 선택)" clearLabel="선택 해제" />
        </div>
        <div className="flex overflow-hidden rounded border border-gray-300">
          <button className={`px-3 py-1.5 text-sm ${r.mode === 'PERSON' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={r.mode === 'PERSON'} onClick={() => r.setMode('PERSON')}>
            개인 기준 조회
          </button>
          <button className={`px-3 py-1.5 text-sm ${r.mode === 'FAMILY' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={r.mode === 'FAMILY'} onClick={() => r.setMode('FAMILY')}>
            세대(가족) 합산 조회
          </button>
        </div>
        {r.mode === 'FAMILY' ? (
          <span className="pb-2 text-xs text-gray-500">집계 기준: {f.basis === 'CURRENT' ? '현재 세대' : '납부 당시 세대'} (상단 토글에서 변경)</span>
        ) : null}
      </div>

      {r.hasSelection ? (
        <>
          <div className="text-sm">
            <b>{r.selectedLabel}</b> · {r.mode === 'PERSON' ? '개인' : '세대 합산'} · {f.label}
          </div>
          <div className="flex flex-wrap gap-2">
            {r.byType.map((t) => (
              <span key={t.id} className="rounded bg-gray-100 px-3 py-1 text-sm">
                {t.name} <b>{formatWon(t.amount)}</b>
              </span>
            ))}
            <span className="rounded bg-blue-600 px-3 py-1 text-sm text-white">
              합계 <b>{formatWon(r.total)}</b>
            </span>
          </div>

          <div className="rounded border">
            <div className={`${GRID} border-b bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-600`}>
              <span>날짜</span>
              <span>표기명</span>
              <span>헌금 종류</span>
              <span className="text-right">금액</span>
              <span className="pl-3">메모</span>
              <span className="text-right">관리</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              {r.rows.slice(paging.from, paging.to).map(({ donation, typeName, amountLabel }) => (
                <div key={donation.id} className={`${GRID} w-full border-b border-gray-100 px-2 text-sm`} style={{ height: ROW_HEIGHT }}>
                  <span>{donation.date}</span>
                  <span className="truncate">
                    <NameWithTag name={donation.donorDisplayName} tag={tagOf(donation.memberId)} />
                  </span>
                  <span>{typeName}</span>
                  <span className="text-right tabular-nums">{amountLabel}</span>
                  <span className="truncate pl-3 text-gray-600">{donation.memo}</span>
                  <span className="flex justify-end gap-1">
                    <button className="btn px-2 py-0.5 text-xs" onClick={() => editor.open(donation, 'EDIT')}>
                      수정
                    </button>
                    <button className="btn px-2 py-0.5 text-xs" onClick={() => editor.open(donation, 'DELETE')}>
                      삭제
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {r.rows.length === 0 ? <p className="px-3 py-4 text-center text-sm text-gray-500">해당 기간 내역이 없습니다.</p> : null}
          </div>
          <Pager paging={paging} />
        </>
      ) : (
        <p className="text-sm text-gray-500">성도를 검색해 선택하세요.</p>
      )}
      <DonationEditModal editor={editor} />
    </section>
  );
}
