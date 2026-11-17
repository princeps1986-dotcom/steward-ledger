import { useVirtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';
import { useIsPrinting } from './useIsPrinting';

/**
 * 진짜 <table>의 줄을 가상 스크롤로 그리기 위한 값.
 * `indexes`의 줄만 그리고, <tbody> 위·아래에 `padTop`/`padBottom` 높이의 빈 줄을 두며,
 * 각 <tr>에 `data-index={index}`와 `ref={measure}`를 달면 실제 줄 높이로 보정됩니다. 인쇄할 때는 모든 줄을 그립니다.
 */
export function useVirtualRows(count: number, scrollRef: RefObject<HTMLElement | null>, estimate = 41) {
  const printing = useIsPrinting();
  const v = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan: 10,
    initialRect: { width: 0, height: 600 }, // 첫 그리기에도 줄이 나오도록(곧 실제 크기로 갱신됨)
  });
  if (printing) return { indexes: Array.from({ length: count }, (_, i) => i), padTop: 0, padBottom: 0, measure: undefined };
  const items = v.getVirtualItems();
  return {
    indexes: items.map((i) => i.index),
    padTop: items[0]?.start ?? 0,
    padBottom: items.length ? v.getTotalSize() - items[items.length - 1].end : 0,
    measure: v.measureElement,
  };
}
