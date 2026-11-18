import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * 종합 보고서 표·전체 입력 내역·성도 정보가 함께 쓰는 스크롤 영역.
 * 높이는 `--fit-h`(화면에 남은 높이)로 정해 표의 아래쪽(고정 합계 행 포함)이 항상 화면 안에 들어오게 하고,
 * 인쇄할 때는 제한을 풉니다.
 */
export const REPORT_SCROLL = 'max-h-[var(--fit-h,72vh)] overflow-auto print:max-h-none print:overflow-visible';

/** 표 아래 페이저(54px)·위 간격(12px)·main 아래 여백(16px)+여유가 화면 안에 들어오도록 `useFitHeight`에 넘길 reserve */
export const PAGER_RESERVE = 84;

const MIN_HEIGHT = 240;
const BOTTOM_GAP = 16;

/** 스크롤 영역의 위쪽 위치부터 화면 아래까지 남은 높이(아래에 따로 둘 영역 `reserve`px 제외)를 계산해 `--fit-h`로 돌려줍니다. */
export function useFitHeight(ref: RefObject<HTMLElement | null>, reserve = 0): CSSProperties {
  const [h, setH] = useState<number | null>(null);
  const measure = (): void => {
    const el = ref.current;
    if (!el) return;
    // 페이지가 이미 아래로 스크롤되어 top이 음수여도 화면 높이를 넘지 않도록 0으로 보정합니다.
    const top = Math.max(0, el.getBoundingClientRect().top);
    setH(Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - BOTTOM_GAP - reserve)));
  };
  // 렌더 후마다 확인합니다(영역이 데이터가 생긴 뒤에야 나타나는 경우 포함). 값이 같으면 다시 그려지지 않습니다.
  useEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return (h === null ? {} : { '--fit-h': `${h}px` }) as CSSProperties;
}
