// 시연 데이터(demoData.ts)와 시험 데이터 스크립트(scripts/testdata-core.mjs)가 함께 쓰는 헬퍼.
// 스크립트가 Node에서 이 파일을 바로 불러오므로(.ts 타입 제거 실행) 다른 모듈을 import하지 않습니다.

export const pad2 = (n: number): string => String(n).padStart(2, '0');
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseYmd = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** 고정 시드 난수(mulberry32): 같은 시드면 항상 같은 순서 */
export function rngOf(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전', '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남', '심', '노', '하', '곽', '성', '차', '주', '우', '구', '민'];
export const GIVEN = ['민수', '서연', '지훈', '수빈', '현우', '지민', '하준', '예은', '도윤', '서윤', '준호', '지원', '승현', '유진', '태양', '나연', '성민', '은지', '재원', '소영', '진우', '다은', '동현', '혜진', '상철', '미경', '영수', '순자', '병철', '정희', '광수', '명숙', '기태', '옥순', '한결', '보람', '시우', '아린', '건우', '채원', '용기', '은혜', '믿음', '소망', '사랑', '진리', '평강', '다윗', '요한', '바울'];
