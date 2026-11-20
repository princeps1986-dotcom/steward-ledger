import { useSyncExternalStore } from 'react';
import type { Member, OfferingType } from '../../contexts/types';
import { getItem, hasDonationWithPrefix, KEYS } from '../storage/storageService';
import { DEMO_PREFIX } from './demoData';

/**
 * 시연 데이터 사용 중인지: 시연 성도·시연 헌금 종류·시연 헌금이 한 건이라도 있으면 시연 중입니다(전체를 훑지 않음).
 * 시연 데이터는 id가 DEMO_PREFIX로 시작합니다. 성도·종류는 kv 배열(수백 건)에서, 헌금은 색인 범위 조회로 한 건만 찾습니다.
 */
export async function hasDemoData(): Promise<boolean> {
  const members = (await getItem<Member[]>(KEYS.members)) ?? [];
  if (members.some((m) => m.id.startsWith(DEMO_PREFIX))) return true;
  const types = (await getItem<OfferingType[]>(KEYS.offeringTypes)) ?? [];
  if (types.some((t) => t.id.startsWith(DEMO_PREFIX))) return true;
  return hasDonationWithPrefix(DEMO_PREFIX);
}

/** 시연 중에 백업·복원을 막을 때의 안내 문구 */
const DEMO_BLOCK_MESSAGE = '시연 데이터를 쓰는 동안에는 백업·복원과 자동 백업을 쓸 수 없습니다.\n먼저 [시연 데이터 제거]를 누르세요.';

/** 시연 데이터가 있거나 만드는 중인지(저장소에서 직접 확인하므로 앱 시작 직후에도 정확) */
export async function isDemoBusy(): Promise<boolean> {
  return creating !== null || (await hasDemoData());
}

/** 시연 중이면 오류를 던집니다(수동 백업·복원 서비스의 마지막 방어선) */
export async function assertNoDemo(): Promise<void> {
  if (await isDemoBusy()) throw new Error(DEMO_BLOCK_MESSAGE);
}

// 앱 어디서나(최상단 안내 띠, 설정 화면) 같은 값을 보도록 작은 외부 저장소로 공유합니다.
let active = false;
const listeners = new Set<() => void>();

/** 시연 데이터를 뒤에서 이어 만드는 중이면 진행(끝낸 달/전체 달), 아니면 null */
interface DemoCreating {
  done: number;
  total: number;
}
let creating: DemoCreating | null = null;
export function setDemoCreating(next: DemoCreating | null): void {
  creating = next;
  listeners.forEach((l) => l());
}

export async function refreshDemoState(): Promise<boolean> {
  const next = await hasDemoData();
  if (next !== active) {
    active = next;
    listeners.forEach((l) => l());
  }
  return next;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const useDemoActive = (): boolean => useSyncExternalStore(subscribe, () => active);
export const useDemoCreating = (): DemoCreating | null => useSyncExternalStore(subscribe, () => creating);
