import { desktop } from '../../../services/desktopBridge';
import { usePaging } from '../../../hooks/usePaging';
import { useAuditLogTab, type AuditDonationView, type ReportFilters } from '../../../hooks/useReports';
import { DateText } from '../../shared/DateText';
import { Pager } from '../../shared/Pager';
import { NameWithTag } from './NameWithTag';

function DonationLine({ v }: { v: AuditDonationView | null }) {
  if (!v) return <>(삭제됨)</>;
  return (
    <>
      <DateText date={v.date} plain /> <NameWithTag name={v.name} tag={v.tag} /> {v.typeName} {v.amount}
      {v.memo ? ` (${v.memo})` : ''}
    </>
  );
}

/** 지금 보고 있는 보고서(기간)에 해당하는 내역의 수정·삭제 이력만 표시합니다. */
const PAGE_SIZE = 50;

export function AuditTab({ f }: { f: ReportFilters }) {
  const logs = useAuditLogTab(f);
  const paging = usePaging(logs.length, PAGE_SIZE, f.label);
  const showActor = !!desktop(); // 작업자는 로그인이 있는 PC앱에서만(브라우저 시연 모드에는 없음)
  return (
    <section className="card space-y-3 p-0">
      <p className="px-4 pt-3 text-sm text-gray-600">
        <b>{f.label}</b> 보고서에 해당하는 내역의 수정·삭제 이력만 보여 줍니다. ({logs.length}건)
      </p>
      <div ref={paging.scrollRef} className="overflow-x-auto">
        <table className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th className="th">작업 일시</th>
              <th className="th">유형</th>
              <th className="th">사유</th>
              {showActor ? <th className="th">작업자</th> : null}
              <th className="th">변경 전</th>
              <th className="th">변경 후</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(paging.from, paging.to).map((l) => (
              <tr key={l.id}>
                <td className="td whitespace-nowrap">{l.time}</td>
                <td className={`td font-semibold ${l.actionLabel === '삭제' ? 'text-red-600' : 'text-blue-700'}`}>{l.actionLabel}</td>
                <td className="td">{l.reason}</td>
                {showActor ? <td className="td text-xs text-gray-600">{l.actor || '-'}</td> : null}
                <td className="td text-xs text-gray-600">
                  <DonationLine v={l.before} />
                </td>
                <td className="td text-xs">
                  <DonationLine v={l.after} />
                </td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr>
                <td className="td text-center text-gray-500" colSpan={showActor ? 6 : 5}>
                  이 보고서 기간에 해당하는 수정·삭제 이력이 없습니다.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="px-4 pb-3">
        <Pager paging={paging} />
      </div>
    </section>
  );
}
