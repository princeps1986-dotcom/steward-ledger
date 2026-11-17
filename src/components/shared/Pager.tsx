import { useState } from 'react';
import type { Paging } from '../../hooks/usePaging';
import { formatNumber } from '../../services/domain/amount';
import { pageNumbers } from '../../services/domain/paging';

const BTN = 'btn min-w-8 px-2 py-1 text-xs';

/** 목록 아래의 페이지 이동: « ‹ 1 … 5 6 7 … 2000 › » + 번호 직접 입력 + "총 N건 중 a–b" */
export function Pager({ paging: p, unit = '건' }: { paging: Paging; unit?: string }) {
  const [jump, setJump] = useState('');
  const go = (): void => {
    if (jump.trim() !== '') p.setPage(Number(jump));
    setJump('');
  };
  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="페이지 이동">
      <span className="text-gray-600">
        총 {formatNumber(p.count)}
        {unit} {p.count > 0 ? `중 ${formatNumber(p.from + 1)}–${formatNumber(p.to)}` : ''}
      </span>
      {p.pages > 1 ? (
        <>
          <div className="flex-1" />
          <button className={BTN} onClick={() => p.setPage(1)} disabled={p.page === 1} aria-label="첫 페이지">
            «
          </button>
          <button className={BTN} onClick={() => p.setPage(p.page - 1)} disabled={p.page === 1} aria-label="이전 페이지">
            ‹
          </button>
          {pageNumbers(p.page, p.pages).map((n, i) =>
            n === '…' ? (
              <span key={`gap${i}`} className="px-1 text-gray-400" aria-hidden="true">
                …
              </span>
            ) : (
              <button key={n} className={`${BTN} ${n === p.page ? 'border-blue-600 bg-blue-600 text-white' : ''}`} aria-current={n === p.page ? 'page' : undefined} onClick={() => p.setPage(n)}>
                {n}
              </button>
            ),
          )}
          <button className={BTN} onClick={() => p.setPage(p.page + 1)} disabled={p.page === p.pages} aria-label="다음 페이지">
            ›
          </button>
          <button className={BTN} onClick={() => p.setPage(p.pages)} disabled={p.page === p.pages} aria-label="마지막 페이지">
            »
          </button>
          <input
            className="input w-20 py-1 text-center text-xs"
            inputMode="numeric"
            value={jump}
            placeholder={`1–${p.pages}`}
            aria-label="이동할 페이지 번호"
            onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
            }}
          />
          <button className={BTN} onClick={go}>
            이동
          </button>
        </>
      ) : null}
    </nav>
  );
}
