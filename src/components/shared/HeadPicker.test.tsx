// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Member } from '../../contexts/types';
import { HeadPicker, type HeadOption } from './HeadPicker';

const opt = (i: number, name: string, phoneLast4: string): HeadOption => ({
  id: `h${i}`,
  label: `${name} (-/ ${phoneLast4})`,
  member: { id: `h${i}`, name, position: '', isFamilyHead: true, isActive: true, createdAt: '', updatedAt: '', phoneLast4 } as Member,
});
const many = Array.from({ length: 30 }, (_, i) => opt(i, `김${String.fromCharCode(0xac00 + i)}`, String(1000 + i)));

afterEach(cleanup);

describe('HeadPicker', () => {
  it('shows at most 20 results, narrows by name or phone, and selects with the keyboard', () => {
    const onChange = vi.fn();
    render(<HeadPicker options={many} value="" onChange={onChange} ariaLabel="세대주" />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(20);
    fireEvent.change(input, { target: { value: '1005' } }); // 연락처 뒷자리로 찾기
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('h5');
  });

  it('shows the selected head with [연결 해제], and a disabled note for a family head', () => {
    const onChange = vi.fn();
    const { rerender } = render(<HeadPicker options={many} value="h3" onChange={onChange} ariaLabel="세대주" />);
    expect(screen.getByLabelText('세대주').textContent).toContain('1003');
    fireEvent.click(screen.getByText('연결 해제'));
    expect(onChange).toHaveBeenCalledWith('');
    rerender(<HeadPicker options={many} value="" onChange={onChange} disabled disabledText="연결하지 않습니다" ariaLabel="세대주" />);
    expect((screen.getByLabelText('세대주') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('세대주') as HTMLInputElement).value).toBe('연결하지 않습니다');
  });
});
