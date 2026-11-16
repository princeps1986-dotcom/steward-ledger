// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClosingOverlay } from './ClosingOverlay';

describe('ClosingOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('백업이 짧으면 깜빡이지 않고, 오래 걸리면 [백업 없이 종료]를 보여 준다', () => {
    const onSkip = vi.fn();
    render(<ClosingOverlay onSkip={onSkip} />);
    const dialog = screen.getByRole('alertdialog', { hidden: true });
    expect(dialog.className).toContain('invisible'); // 처음 0.4초는 숨김
    act(() => void vi.advanceTimersByTime(500));
    expect(dialog.className).not.toContain('invisible');
    expect(screen.queryByText('백업 없이 종료')).toBeNull();
    act(() => void vi.advanceTimersByTime(8000));
    fireEvent.click(screen.getByText('백업 없이 종료'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
