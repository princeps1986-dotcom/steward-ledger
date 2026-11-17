/** 페이지 번호(1부터)를 1~pages 안으로 맞춥니다. 숫자가 아니면 1. */
export function clampPage(page: number, pages: number): number {
  const p = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, p), Math.max(1, pages));
}

/** 페이저에 보여 줄 번호: 처음·끝·현재 주변만 두고 건너뛴 곳은 '…' (예: 1 … 5 6 7 … 2000). */
export function pageNumbers(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(n - 1); // 하나만 건너뛰면 '…' 대신 그 번호를 보여 줌
    else if (prev !== undefined && n - prev > 2) out.push('…');
    out.push(n);
  });
  return out;
}
