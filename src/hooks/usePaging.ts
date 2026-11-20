import { useEffect, useRef, useState } from 'react';
import { clampPage } from '../services/domain/paging';

/**
 * 목록 페이징. `resetKey`(기간·검색어 등)가 바뀌면 1페이지로 돌아가고, 건수가 줄어 현재 페이지가 없어지면(수정·삭제 후) 마지막 페이지로 맞춥니다.
 * from~to는 현재 페이지의 줄 번호 범위(0부터, to는 미포함)입니다.
 */
export function usePaging(count: number, size: number, resetKey: string) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  const pages = Math.max(1, Math.ceil(count / size));
  const page = clampPage(state.key === resetKey ? state.page : 1, pages);
  const from = (page - 1) * size;
  // 스크롤되는 목록 영역에 붙이면, 쪽을 옮길 때 그 영역을 맨 위로 되돌리고 화면 밖으로 밀려난 영역 위쪽도 보이게 합니다.
  const scrollRef = useRef<HTMLDivElement>(null);
  // 기간·검색어 등이 바뀌면(resetKey) 그 목록 영역도 맨 위로 되돌립니다.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [resetKey]);
  const setPage = (p: number) => {
    setState({ page: clampPage(p, pages), key: resetKey });
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollIntoView?.({ block: 'nearest' });
    }
  };
  return { page, pages, count, from, to: Math.min(count, from + size), setPage, scrollRef };
}

export type Paging = ReturnType<typeof usePaging>;
