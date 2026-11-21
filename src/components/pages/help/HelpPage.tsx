import { useHelpPage } from '../../../hooks/useHelpPage';

/** 긴 설명을 읽기 쉽게 문장(마침표·물음표·느낌표 뒤 공백)과 ①②③ 항목 단위로 줄을 나눕니다. */
function splitLines(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=\S)|(?=[①-⑩])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 한 줄: ①②③ 같은 번호 줄은 그대로, 나머지는 불릿(•)을 붙이고, [단추 이름]은 굵은 파란 글씨로 눈에 띄게 합니다. */
function Line({ text }: { text: string }) {
  const numbered = /^[①-⑩]/u.test(text);
  const parts = text.split(/(\[[^\]]+\])/g).filter(Boolean);
  return (
    <p className={numbered ? 'pl-0' : 'flex gap-2'}>
      {numbered ? null : (
        <span aria-hidden className="select-none text-blue-400">
          •
        </span>
      )}
      <span>
        {parts.map((part, i) =>
          /^\[[^\]]+\]$/.test(part) ? (
            <b key={i} className="font-semibold text-blue-700">
              {part}
            </b>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </span>
    </p>
  );
}

/** 메뉴별 설명서 */
export function HelpPage() {
  const h = useHelpPage();
  return (
    <div className="space-y-4">
    <div className="card flex flex-wrap items-center gap-3">
      <input
        type="search"
        className="input min-w-0 flex-1"
        placeholder="설명서 검색 (예: 백업, 복원, 복구하기)"
        aria-label="설명서 검색"
        value={h.query}
        onChange={(e) => h.setQuery(e.target.value)}
      />
      {h.searching && (
        <span className="text-sm text-gray-600" role="status">
          {h.resultCount > 0 ? `검색 결과 ${h.resultCount}건` : '검색 결과가 없습니다. 다른 낱말로 찾아 보세요.'}
        </span>
      )}
    </div>
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
          <section key={s.id} id={s.id} className="card scroll-mt-2 space-y-5">
            <div className="border-b border-gray-200 pb-3">
              <h2 className="text-xl font-bold text-gray-900">{s.title}</h2>
              <p className="mt-0.5 text-sm text-gray-600">{s.summary}</p>
            </div>
            {s.items.map((item) => (
              <div key={item.heading} className="space-y-2 border-b border-dashed border-gray-200 pb-4 last:border-b-0 last:pb-0">
                <h3 className="border-l-4 border-blue-500 pl-2 text-[15px] font-bold text-gray-900">{item.heading}</h3>
                <div className="space-y-2.5 pl-3">
                  {item.body.map((para, i) => {
                    const highlight = typeof para !== 'string';
                    const lines = splitLines(highlight ? para.text : para);
                    return highlight ? (
                      <div
                        key={i}
                        className="my-2 space-y-1 rounded-md border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-sm font-semibold leading-relaxed text-blue-900 underline decoration-blue-400 decoration-1 underline-offset-[5px]"
                      >
                        {lines.map((line, j) => (
                          <p key={j}>{line}</p>
                        ))}
                      </div>
                    ) : (
                      <div key={i} className="space-y-1 text-[15px] leading-7 text-gray-700">
                        {lines.map((line, j) => (
                          <Line key={j} text={line} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
    </div>
  );
}
