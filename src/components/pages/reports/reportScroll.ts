import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * 종합 보고서 표와 전체 입력 내역 목록이 함께 쓰는 스크롤 영역.
 * 높이는 `--fit-h`(화면에 남은 높이)로 정해 표의 아래쪽(고정 합계 행 포함)이 항상 화면 안에 들어오게 하고,
 * 인쇄할 때는 제한을 풉니다.
 */
export const REPORT_SCROLL = 'max-h-[var(--fit-h,72vh)] overflow-auto print:max-h-none print:overflow-visible';

const MIN_HEIGHT = 240;
const BOTTOM_GAP = 16;

/** 스크롤 영역의 위쪽 위치부터 화면 아래까지 남은 높이를 계산해 `--fit-h`로 돌려줍니다. */
export function useFitHeight(ref: RefObject<HTMLElement | null>): CSSProperties {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      setH(Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - el.getBoundingClientRect().top - BOTTOM_GAP)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [ref]);
  return (h === null ? {} : { '--fit-h': `${h}px` }) as CSSProperties;
}
