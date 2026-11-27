import { describe, expect, it } from 'vitest';
import { buildPreview, LINE_KEY, normalizeRows, parsePastedTable } from './memberImportService';

describe('성도 명단 붙여넣기(이름만 읽음)', () => {
  it('이름 한 열을 읽고 미리보기까지 이어진다', () => {
    const raw = parsePastedTable('\n이름\r\n김철수\n\n이영희\n');
    expect(raw.map((r) => r.이름)).toEqual(['김철수', '이영희']);
    expect(raw[1][LINE_KEY]).toBe('4'); // 제목 1행, 중간 빈 줄도 번호를 차지
    const preview = buildPreview(normalizeRows(raw), []);
    expect(preview.map((r) => r.status)).toEqual(['OK', 'OK']);
  });

  it.each(['성명', '성도명', '성도'])('제목 "%s"도 이름 열로 읽는다', (h) => {
    expect(parsePastedTable(`${h}\n김철수`).map((r) => r.이름)).toEqual(['김철수']);
  });

  it('다른 열이 있어도 이름만 읽고, 이름이 빈 줄은 건너뛴다', () => {
    const raw = parsePastedTable('직분\t성도명\t대표자여부\n집사\t김철수\tY\n권사\t\tN');
    expect(raw).toEqual([{ 이름: '김철수', [LINE_KEY]: '2' }]);
  });

  it('이름 제목이 없으면 안내 오류', () => {
    expect(() => parsePastedTable('')).toThrow('제목 줄');
    expect(() => parsePastedTable('김철수\n이영희')).toThrow('이름·성명·성도명·성도');
  });
});
