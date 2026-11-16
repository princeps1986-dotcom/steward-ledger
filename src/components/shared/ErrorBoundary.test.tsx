// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('깨진 내역');
  return <p>정상 화면</p>;
}

function Harness() {
  const [explode, setExplode] = useState(true);
  return (
    <>
      <button onClick={() => setExplode(false)}>고치기</button>
      <ErrorBoundary>
        <Bomb explode={explode} />
      </ErrorBoundary>
    </>
  );
}

describe('ErrorBoundary', () => {
  it('화면 오류가 나도 앱 전체 대신 안내를 보여 주고 다시 시도하면 복구된다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Harness />);
    expect(screen.getByRole('alert').textContent).toContain('깨진 내역');
    fireEvent.click(screen.getByText('고치기'));
    fireEvent.click(screen.getByText('다시 시도'));
    expect(screen.getByText('정상 화면')).toBeTruthy();
  });
});
