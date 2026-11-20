import type { PageKey } from '../../../hooks/useAppShell';

/** 성도가 한 명도 없을 때(처음 사용) 헌금 입력 화면 맨 위에 보여 주는 시작 안내 */
export function FirstRunGuide({ onNavigate }: { onNavigate(page: PageKey): void }) {
  const steps: { no: number; title: string; desc: string; label: string; page: PageKey }[] = [
    { no: 1, title: '헌금 종류 확인', desc: '십일조·주일헌금 등 교회에서 쓰는 종류와 금액 단추를 확인하세요.', label: '헌금 종류 열기', page: 'offerings' },
    { no: 2, title: '성도 등록', desc: `성도를 한 명씩 등록하거나 CSV 명단을 한 번에 가져오세요.`, label: '성도 정보 열기', page: 'members' },
    { no: 3, title: '헌금 입력', desc: '이 화면으로 돌아와 성도를 검색하고 금액을 입력합니다. Enter만으로 이어서 입력할 수 있습니다.', label: '', page: 'input' },
  ];
  return (
    <section className="no-print card space-y-3 border-blue-200 bg-blue-50" aria-labelledby="first-run-title">
      <h2 id="first-run-title" className="text-base font-bold text-blue-700">
        처음 사용하시나요? 3단계로 시작하세요
      </h2>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.no} className="flex flex-col gap-2 rounded border border-blue-200 bg-white p-3">
            <div className="flex items-center gap-2 font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">{s.no}</span>
              {s.title}
            </div>
            <p className="flex-1 text-sm text-gray-600">{s.desc}</p>
            {s.label ? (
              <button className="btn self-start" onClick={() => onNavigate(s.page)}>
                {s.label}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-sm text-gray-600">
        먼저 체험해 보려면 <button className="font-semibold text-blue-700 underline" onClick={() => onNavigate('settings')}>설정 정보</button>의 [시연 데이터 생성]를,
        자세한 사용법은 <button className="font-semibold text-blue-700 underline" onClick={() => onNavigate('help')}>설명서</button>를 보세요.
      </p>
    </section>
  );
}
