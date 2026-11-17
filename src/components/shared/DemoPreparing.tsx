/** 브라우저로 처음 열 때 시연 데이터를 준비하는 동안 화면을 덮는 안내(진행률 표시) */
export function DemoPreparing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div role="status" aria-live="polite" className="no-print fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6 text-center text-slate-800">
      <p className="text-lg font-bold">시연 데이터를 준비하고 있습니다</p>
      <p className="text-sm text-slate-600">가상의 성도와 헌금 내역을 이 기기에 만드는 중입니다. 처음 한 번만 걸리며 1분 안팎 걸릴 수 있습니다. 이 화면을 닫지 마세요.</p>
      <div className="h-2 w-full max-w-xs overflow-hidden rounded bg-slate-200" aria-hidden="true">
        <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-500">{total > 0 ? `${done} / ${total}개월 (${pct}%)` : '준비 중…'}</p>
    </div>
  );
}
