import { useHelpPage } from '../../../hooks/useHelpPage';

/** 메뉴별 사용 설명서 */
export function HelpPage() {
  const h = useHelpPage();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      <nav className="card h-fit space-y-1 lg:sticky lg:top-0" aria-label="설명서 목차">
        <h2 className="px-3 pb-1 text-xs font-semibold text-gray-500">목차</h2>
        {h.sections.map((s) => (
          <button key={s.id} type="button" className={s.tocClassName} onClick={() => h.goTo(s.id)}>
            {s.title}
          </button>
        ))}
      </nav>

      <div className="space-y-4">
        {h.sections.map((s) => (
          <section key={s.id} id={s.id} className="card scroll-mt-2 space-y-4">
            <div>
              <h2 className="text-lg font-bold">{s.title}</h2>
              <p className="text-sm text-gray-600">{s.summary}</p>
            </div>
            {s.items.map((item) => (
              <div key={item.heading} className="space-y-1">
                <h3 className="text-sm font-semibold text-gray-800">{item.heading}</h3>
                {item.body.map((para, i) => (
                  <p key={i} className="text-sm leading-relaxed text-gray-700">
                    {para}
                  </p>
                ))}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
