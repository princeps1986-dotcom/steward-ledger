// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../../../contexts/AppProviders';
import { KEYS } from '../../../services/storage/keys';
import { db } from '../../../services/storage/db';
import { SettingsPage } from '../settings/SettingsPage';
import { OfferingsPage } from './OfferingsPage';

const renderPage = (ui: React.ReactElement) => render(<AppProviders>{ui}</AppProviders>);
const input = () => screen.getByLabelText(/이 금액 초과 시 확인창/) as HTMLInputElement;
const saved = async () => ((await db.kv.get(KEYS.settings)) as { largeAmountThreshold?: number } | undefined)?.largeAmountThreshold;

beforeEach(async () => {
  await db.kv.clear();
});
afterEach(cleanup);

describe('헌금 종류 화면의 큰 금액 확인 기준', () => {
  it('맨 위에 기본값이 보이고, 바꾸기 전에는 저장 단추가 꺼져 있다', async () => {
    renderPage(<OfferingsPage />);
    expect(input().value).toBe('10,000,000');
    expect((screen.getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true);
    const top = screen.getAllByRole('heading', { level: 3 })[0];
    expect(top.textContent).toContain('큰 금액 확인 기준');
  });

  it('값을 바꾸고 [저장]을 누르면 설정에 반영되고, [입력 취소]는 되돌린다', async () => {
    renderPage(<OfferingsPage />);
    fireEvent.change(input(), { target: { value: '5000000' } });
    expect(screen.getByText('저장하지 않은 변경이 있습니다.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '입력 취소' }));
    expect(input().value).toBe('10,000,000');
    fireEvent.change(input(), { target: { value: '5000000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(async () => expect(await saved()).toBe(5_000_000));
    expect(input().value).toBe('5,000,000');
    expect(await screen.findByText('큰 금액 확인 기준을 저장했습니다.')).toBeTruthy();
    // 다시 고치기 시작하면 저장 안내는 사라진다
    fireEvent.change(input(), { target: { value: '6000000' } });
    expect(screen.queryByText('큰 금액 확인 기준을 저장했습니다.')).toBeNull();
  });

  it('비워서 저장하면 오류를 보여 주고 값은 바뀌지 않는다', async () => {
    renderPage(<OfferingsPage />);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('큰 금액 확인 기준을 입력하세요.')).toBeTruthy();
    expect(await saved()).toBeUndefined();
  });

  it('설정 화면에는 더 이상 없다', async () => {
    renderPage(<SettingsPage />);
    expect(await screen.findByText('화면 테마')).toBeTruthy();
    expect(screen.queryByText(/큰 금액 확인 기준/)).toBeNull();
    expect(screen.queryByRole('button', { name: '설정 저장' })).toBeNull();
  });
});
