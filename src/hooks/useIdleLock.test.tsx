// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleLock } from './useIdleLock';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useIdleLock', () => {
  it('조작이 없으면 정해진 시간 뒤 한 번 부른다', () => {
    const idle = vi.fn();
    renderHook(() => useIdleLock(true, idle, 1000));
    vi.advanceTimersByTime(999);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('조작하면 시간이 다시 시작된다(1초 안의 연속 조작은 한 번으로)', () => {
    const idle = vi.fn();
    renderHook(() => useIdleLock(true, idle, 5000));
    vi.advanceTimersByTime(4000);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(4000);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1100);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  // 절전 중에는 타이머가 멈출 수 있고 시계만 흘러갑니다: 시계만 1시간 옮겨 그 상황을 흉내 냅니다.
  it('절전에서 깨어난 뒤 첫 조작이 시간을 다시 시작하지 않고 바로 잠근다', () => {
    const idle = vi.fn();
    renderHook(() => useIdleLock(true, idle, 5000));
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    window.dispatchEvent(new Event('keydown'));
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('절전에서 깨어나면 조작이 없어도 곧 잠근다', () => {
    const idle = vi.fn();
    renderHook(() => useIdleLock(true, idle, 5000));
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    vi.advanceTimersByTime(1000); // 깨어난 뒤 1초 안에
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('active가 아니면 세지 않는다', () => {
    const idle = vi.fn();
    renderHook(() => useIdleLock(false, idle, 100));
    vi.advanceTimersByTime(1000);
    expect(idle).not.toHaveBeenCalled();
  });
});
