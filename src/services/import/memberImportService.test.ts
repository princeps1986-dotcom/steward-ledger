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

  it('미리보기 행 번호는 원본 줄 번호(빈 줄 포함)를 쓴다', () => {
    const preview = buildPreview(normalizeRows(parsePastedTable('이름\n김철수\n\n이영희')), []);
    expect(preview.map((r) => r.line)).toEqual([2, 4]);
  });

  it('띄어쓰기만 다른 이름은 같은 사람으로 본다(기존 성도·목록 안·대표자)', () => {
    const existing = [{ id: 'k', name: '김철수', position: '', isActive: true, isFamilyHead: true, familyGroupId: 'k', createdAt: '', updatedAt: '' }];
    const rows = normalizeRows([
      { 이름: '김 철수' },
      { 이름: '이영희' },
      { 이름: '이 영희' },
      { 이름: '박민수', 대표자여부: 'N', 대표자이름: '김철 수' },
    ]);
    const preview = buildPreview(rows, existing);
    expect(preview.map((r) => r.status)).toEqual(['DUPLICATE', 'OK', 'ERROR', 'OK']);
    expect(preview[3].headRef).toEqual({ kind: 'EXISTING', memberId: 'k' });
  });

  it('이름 제목이 없으면 안내 오류', () => {
    expect(() => parsePastedTable('')).toThrow('제목 줄');
    expect(() => parsePastedTable('김철수\n이영희')).toThrow('이름·성명·성도명·성도');
  });
});
