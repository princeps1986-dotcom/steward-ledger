import { useState } from 'react';
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
  return { page, pages, count, from, to: Math.min(count, from + size), setPage: (p: number) => setState({ page: clampPage(p, pages), key: resetKey }) };
}

export type Paging = ReturnType<typeof usePaging>;
