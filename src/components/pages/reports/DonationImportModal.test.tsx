// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DonationImportModal } from './DonationImportModal';

const row = (i: number) => ({
  rowNo: i + 2, line: i + 2, name: `성도${i}`, typeName: '십일조', amountRaw: '20000000', date: '2026-11-22', memo: '', messages: [], status: 'WARN', statusLabel: '확인',
});
const rows = Array.from({ length: 101 }, (_, i) => row(i));
const noop = () => {};

vi.mock('../../../hooks/useDonationImport', () => ({
  useDonationImport: () => ({
    fileName: 'a.csv', loadId: 1, hasPreview: true, hasDateColumn: true, needsDate: false, preview: rows,
    summary: { save: 101, saved: 0, warn: 101, err: 0 }, largeCount: 1, largeRows: [rows[100]], largeConfirmed: false,
    canSave: false, dateError: '파일에 날짜가 2개 있습니다.', error: null, result: null, busy: false, close: noop,
  }),
}));

afterEach(cleanup);

it('100줄씩 나누고, 날짜 안내와 다른 쪽의 큰 금액 줄을 보여 줍니다', () => {
  render(<DonationImportModal open onClose={noop} />);
  const bodyRows = () => document.querySelectorAll('tbody tr').length;
  expect(bodyRows()).toBe(100);
  expect(screen.getByText('파일에 날짜가 2개 있습니다.')).toBeTruthy();
  expect(screen.getByRole('list', { name: '큰 금액 줄' }).textContent).toContain('102행 · 성도100');
  fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }));
  expect(bodyRows()).toBe(1);
});
