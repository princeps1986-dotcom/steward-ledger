import { describe, expect, it } from 'vitest';
import { createExclusive } from './exclusive';

describe('createExclusive', () => {
  it('끝나기 전에 연타한 호출은 무시하고, 끝나면 다시 실행된다', async () => {
    const run = createExclusive({ current: false });
    let calls = 0;
    const work = () => run(async () => { calls++; await new Promise((r) => setTimeout(r, 10)); });
    await Promise.all([work(), work(), work(), work()]);
    expect(calls).toBe(1);
    await work();
    expect(calls).toBe(2);
  });

  it('작업이 실패해도 가드가 풀린다', async () => {
    const run = createExclusive({ current: false });
    await expect(run(async () => { throw new Error('x'); })).rejects.toThrow('x');
    let ok = false;
    await run(async () => { ok = true; });
    expect(ok).toBe(true);
  });
});
