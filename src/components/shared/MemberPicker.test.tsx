// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../contexts/types';
import { MemberPicker, type PickerOption } from './MemberPicker';

const opt = (i: number, name: string, phoneLast4: string): PickerOption => ({
  id: `h${i}`,
  label: `${name} (-/ ${phoneLast4})`,
  member: { id: `h${i}`, name, position: '', isFamilyHead: true, isActive: true, createdAt: '', updatedAt: '', phoneLast4 } as Member,
});
const many = Array.from({ length: 300 }, (_, i) => opt(i, `김${String.fromCharCode(0xac00 + i)}`, String(1000 + i)));

afterEach(cleanup);

describe('MemberPicker', () => {
  // 줄 그리기(가상 스크롤)는 화면 크기가 필요해 jsdom에서는 확인할 수 없으므로(실제 브라우저에서 확인), 전체 길이와 키보드 선택을 검사합니다.
  it('sizes the list for all matches, moves past the visible rows with the keyboard, and narrows by phone', () => {
    const onChange = vi.fn();
    render(<MemberPicker options={many} value="" onChange={onChange} ariaLabel="대표자" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByRole('listbox').style.height).toBe('10800px'); // 300명 x 36px
    for (let i = 0; i < 50; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('h50');
    fireEvent.change(input, { target: { value: '1005' } }); // 연락처 뒷자리로 찾기
    expect(screen.getByRole('listbox').style.height).toBe('36px');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('h5');
  });

  it('shows the selected head with [연결 해제], and a disabled note for a family head', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MemberPicker options={many} value="h3" onChange={onChange} ariaLabel="대표자" />);
    expect(screen.getByLabelText('대표자').textContent).toContain('1003');
    fireEvent.click(screen.getByText('연결 해제'));
    expect(onChange).toHaveBeenCalledWith('');
    rerender(<MemberPicker options={many} value="" onChange={onChange} disabled disabledText="연결하지 않습니다" ariaLabel="대표자" />);
    expect((screen.getByLabelText('대표자') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('대표자') as HTMLInputElement).value).toBe('연결하지 않습니다');
  });
});
