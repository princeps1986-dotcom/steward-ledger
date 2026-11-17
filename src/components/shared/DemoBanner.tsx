import { useDemoActive, useDemoCreating } from '../../services/demo/demoState';

/** 시연 데이터를 쓰는 동안 최상단 메뉴 위에 항상 보이는 안내 띠(인쇄에는 나오지 않음) */
export function DemoBanner() {
  const active = useDemoActive();
  const creating = useDemoCreating();
  if (!active) return null;
  return (
    <div role="status" className="no-print bg-amber-400 px-4 py-1.5 text-center text-sm font-semibold text-amber-950">
      시연 데이터 사용 중 — 지금 보이는 데이터는 가상의 시연 데이터입니다. 설정 &gt; 위험 구역의 [시연 데이터 제거]로 원래 데이터를 되살릴 수 있습니다.
      {creating ? ` (과거 내역을 만드는 중 ${creating.done}/${creating.total}개월 — 오래된 달은 아직 비어 있을 수 있습니다)` : null}
    </div>
  );
}
