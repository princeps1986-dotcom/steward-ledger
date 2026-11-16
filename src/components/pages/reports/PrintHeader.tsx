import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatPrintStamp } from '../../../services/domain/dates';

export interface PrintStat {
  label: string;
  value: string;
}

/** 인쇄하는 순간의 시각을 돌려줍니다. 화면을 오래 열어 두었어도 인쇄 직전(beforeprint)에 갱신됩니다. */
function usePrintStamp(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // 인쇄 미리보기가 갱신된 값을 그리도록 동기적으로 반영합니다.
    const refresh = (): void => flushSync(() => setNow(new Date()));
    window.addEventListener('beforeprint', refresh);
    return () => window.removeEventListener('beforeprint', refresh);
  }, []);
  return formatPrintStamp(now);
}

/**
 * 인쇄 시에만 보이는 최상단 머리글: 왼쪽에 보고서 제목, 오른쪽에 요약 수치와 출력일시를 한 줄로 둡니다.
 * (상·하단 여백을 줄이고 표에 더 많은 행을 담기 위해 한 줄로 압축합니다.)
 */
export function PrintHeader({ title, stats = [] }: { title: string; stats?: PrintStat[] }) {
  const stamp = usePrintStamp();
  return (
    <div className="print-flex rpt-title-bar items-end justify-between gap-6 pb-1">
      <h2 className="text-[14pt] font-extrabold leading-tight">{title}</h2>
      <dl className="flex items-baseline gap-x-5 text-[10pt]">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1">
            <dt>{s.label}</dt>
            <dd className="font-extrabold">{s.value}</dd>
          </div>
        ))}
        <div className="flex items-baseline gap-1">
          <dt>출력일시</dt>
          <dd className="font-bold">{stamp}</dd>
        </div>
      </dl>
    </div>
  );
}
