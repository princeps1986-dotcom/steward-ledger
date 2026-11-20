import { useDonationEditor } from '../../../hooks/useDonationEditor';
import { useNameTag } from '../../../hooks/useNameTag';
import { usePaging } from '../../../hooks/usePaging';
import { usePersonalReport, type ReportFilters } from '../../../hooks/useReports';
import { formatWon } from '../../../services/domain/amount';
import { MemberPicker } from '../../shared/MemberPicker';
import { DateText } from '../../shared/DateText';
import { Pager } from '../../shared/Pager';
import { DonationEditModal } from './DonationEditModal';
import { NameWithTag } from './NameWithTag';

const PAGE_SIZE = 100;
const ROW_HEIGHT = 40;
const GRID = 'grid grid-cols-[135px_1fr_140px_130px_1fr_120px] items-center';

export function PersonalTab({ f }: { f: ReportFilters }) {
  const r = usePersonalReport(f);
  const tagOf = useNameTag(true);
  const editor = useDonationEditor();
  const paging = usePaging(r.rows.length, PAGE_SIZE, `${r.selectedId}|${r.mode}|${f.label}`);

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <span className="label">성도 검색 (비활성 성도 포함)</span>
          <MemberPicker options={r.options} value={r.selectedId ?? ''} onChange={r.select} ariaLabel="성도 검색" placeholder="이름·연락처 뒷자리 (↑↓ 이동 · Enter 선택)" clearLabel="선택 해제" />
        </div>
        {f.periodType === 'YEAR' ? (
        <div className="flex overflow-hidden rounded border border-gray-300">
          <button className={`px-3 py-1.5 text-sm ${r.mode === 'PERSON' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={r.mode === 'PERSON'} onClick={() => r.setMode('PERSON')}>
            개인 기준 조회
          </button>
          <button className={`px-3 py-1.5 text-sm ${r.mode === 'FAMILY' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={r.mode === 'FAMILY'} onClick={() => r.setMode('FAMILY')}>
            세대(가족) 합산 조회
          </button>
        </div>
        ) : null}
        {r.mode === 'FAMILY' ? (
          <div>
            <span className="label">세대 집계 기준</span>
            <div className="flex overflow-hidden rounded border border-gray-300">
              <button className={`px-3 py-1.5 text-sm ${f.basis === 'CURRENT' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={f.basis === 'CURRENT'} onClick={() => f.setBasis('CURRENT')}>
                현재 세대 기준
              </button>
              <button className={`px-3 py-1.5 text-sm ${f.basis === 'SNAPSHOT' ? 'bg-blue-600 text-white' : 'bg-white'}`} aria-pressed={f.basis === 'SNAPSHOT'} onClick={() => f.setBasis('SNAPSHOT')}>
                납부 당시 세대 기준
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {f.periodType !== 'YEAR' ? <p className="-mt-2 text-xs text-gray-500">※ 세대 합산 조회는 연도별 보고서에서만 가능합니다.</p> : null}

      {r.hasSelection ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <b>{r.selectedLabel}</b> · {r.mode === 'PERSON' ? '개인' : '세대 합산'} · {f.label}
            {r.mode === 'FAMILY' ? (
              // 테마 색 변수가 정의된 blue-100/400/600/700만 써서 네 테마(어두운 테마 포함) 모두에서 글씨가 읽히게 합니다.
              <span className="rounded border border-l-4 border-blue-400 border-l-blue-600 bg-blue-100 px-3 py-1 text-base font-bold text-blue-700">
                <span className="mr-1.5 text-xs font-semibold">세대주</span>
                {r.headLabel}
              </span>
            ) : null}
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
            <div className={`${GRID} w-max min-w-full border-b bg-gray-50 px-2 py-1.5 text-xs font-semibold text-gray-600`}>
              <span>날짜</span>
              <span>표기명</span>
              <span>헌금 종류</span>
              <span className="text-right">금액</span>
              <span className="pl-3">메모</span>
              <span className="text-right">관리</span>
            </div>
            <div ref={paging.scrollRef} aria-busy={r.loading} className={`max-h-[480px] overflow-y-auto transition-opacity ${r.stale ? 'opacity-60' : ''}`}>
              {r.rows.slice(paging.from, paging.to).map(({ donation, typeName, amountLabel }) => (
                <div key={donation.id} className={`${GRID} w-max min-w-full border-b border-gray-100 px-2 text-sm`} style={{ height: ROW_HEIGHT }}>
                  <DateText date={donation.date} />
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
            {/* 이전 결과가 있으면 흐리게 두고, 결과가 없을 때만 빈 줄을 보여 줍니다(300ms 넘게 걸릴 때만). */}
            {r.loading && r.rows.length === 0 ? (
              r.slow ? (
                <>
                  {[0, 1, 2].map((i) => (
                    <div key={i} aria-hidden="true" className={`${GRID} w-max min-w-full border-b border-gray-100 px-2`} style={{ height: ROW_HEIGHT }}>
                      {[0, 1, 2, 3, 4, 5].map((c) => (
                        <span key={c} className="mr-3 h-3 rounded bg-gray-100" />
                      ))}
                    </div>
                  ))}
                  <p role="status" className="px-3 py-4 text-center text-sm text-gray-400">
                    내역을 불러오고 있습니다…
                  </p>
                </>
              ) : null
            ) : r.failed ? (
              <p role="alert" className="px-3 py-4 text-center text-sm text-red-600">
                내역을 불러오지 못했습니다. 다시 선택해 주세요.
              </p>
            ) : r.rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-gray-500">해당 기간 내역이 없습니다.</p>
            ) : null}
          </div>
          <Pager paging={paging} />
        </>
      ) : (
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center">
          <p className="text-base font-semibold text-gray-700">조회할 성도를 선택하세요</p>
          <p className="mt-1 text-sm text-gray-500">위 검색창에 이름이나 연락처 뒷자리를 입력하면 내역을 볼 수 있습니다.</p>
        </div>
      )}
      <DonationEditModal editor={editor} />
    </section>
  );
}
