/**
 * 정렬용 비교 함수. String.localeCompare는 호출할 때마다 로케일 규칙을 다시 찾아 느리므로,
 * 한글 이름처럼 규칙이 필요한 것은 한 번 만든 Intl.Collator를 재사용하고(결과는 localeCompare(b, 'ko')와 같음),
 * 날짜(YYYY-MM-DD)·ISO 시각처럼 형식이 고정된 문자열은 일반 문자열 비교를 씁니다.
 */
const ko = new Intl.Collator('ko');
const koNumeric = new Intl.Collator('ko', { numeric: true });

/** 한글 규칙 비교 (localeCompare(b, 'ko')와 같은 결과) */
export const compareKo = (a: string, b: string): number => ko.compare(a, b);
/** 한글 규칙 + 숫자는 크기순(무명2 < 무명10) */
export const compareKoNumeric = (a: string, b: string): number => koNumeric.compare(a, b);
/** 형식이 고정된 문자열(날짜·ISO 시각) 비교 */
export const compareFixed = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
