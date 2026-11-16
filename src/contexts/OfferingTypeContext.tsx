import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { newId } from '../services/domain/ids';
import { migrateOfferingTypesV22, migrateOfferingTypesV23, migrateOfferingTypesV24 } from '../services/domain/migrations';
import { DEFAULT_OFFERING_TYPES, migrateOfferingTypesV21, type OfferingTypeDraft } from '../services/domain/offeringDefaults';
import { donationKey, getItem, KEYS, listDonationYears, transact, type Write } from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import type { Donation, OfferingType } from './types';

export type { OfferingTypeDraft };

interface OfferingActions {
  save(draft: OfferingTypeDraft, id?: string): Promise<string | null>;
  /** 이 헌금 종류로 입력된 헌금 내역 수(모든 연도). 0이면 삭제할 수 있습니다. */
  countUsage(id: string): Promise<number>;
  /** 입력된 헌금이 없을 때만 삭제합니다. 삭제하면 'deleted', 입력된 헌금이 있으면 사용 건수, 없는 종류면 'missing'. */
  remove(id: string): Promise<{ kind: 'deleted' } | { kind: 'used'; count: number } | { kind: 'missing' }>;
  reload(): Promise<void>;
}

interface OfferingState {
  types: OfferingType[];
  /** 정렬된 활성 종류 */
  activeTypes: OfferingType[];
  typeById: Map<string, OfferingType>;
  loaded: boolean;
  actions: OfferingActions;
}

const OfferingCtx = createContext<OfferingState | null>(null);

export function OfferingTypeProvider({ children }: { children: ReactNode }) {
  const [types, setTypes] = useState<OfferingType[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const stored = await getItem<OfferingType[]>(KEYS.offeringTypes);
    if (stored === null) {
      // 최초 실행 시 기본 헌금 종류 시드
      const { result } = await transact(async (read) => {
        const again = await read<OfferingType[]>(KEYS.offeringTypes);
        if (again) return { writes: [], result: again };
        const seeded = DEFAULT_OFFERING_TYPES.map((t) => ({ ...t, id: newId() }));
        // 기본값이 이미 v2.1 기준이므로 보정 완료 표시도 함께 기록
        return {
          writes: [
            { key: KEYS.offeringTypes, value: seeded },
            { key: KEYS.migrationOfferingV21, value: true },
            { key: KEYS.migrationOfferingV22, value: true },
            { key: KEYS.migrationOfferingV23, value: true },
            { key: KEYS.migrationOfferingV24, value: true },
          ],
          result: seeded,
        };
      }, { markDirty: false });
      setTypes(result);
    } else {
      // 버전별 1회 보정 (완료 플래그가 없을 때만 실행)
      //  v2.1: 이전 기본값(건축·선교 = 드롭다운, 금액 단추 없음)만 기본 나열로 이동
      //  v2.2: 건축·선교헌금 금액 단추에 빠진 금액 추가
      //  v2.4: 십일조 금액 단추에 30만·40만 추가
      //  v2.14: 구제헌금(기본 나열)·특별헌금(기타 드롭다운) 추가
      const { result } = await transact(async (read) => {
        const latest = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? stored;
        const done21 = (await read<boolean>(KEYS.migrationOfferingV21)) === true;
        const done22 = (await read<boolean>(KEYS.migrationOfferingV22)) === true;
        const done23 = (await read<boolean>(KEYS.migrationOfferingV23)) === true;
        const done24 = (await read<boolean>(KEYS.migrationOfferingV24)) === true;
        if (done21 && done22 && done23 && done24) return { writes: [], result: latest };
        let list = latest;
        const writes: Write[] = [];
        if (!done21) {
          list = migrateOfferingTypesV21(list) ?? list;
          writes.push({ key: KEYS.migrationOfferingV21, value: true });
        }
        if (!done22) {
          list = migrateOfferingTypesV22(list) ?? list;
          writes.push({ key: KEYS.migrationOfferingV22, value: true });
        }
        if (!done23) {
          list = migrateOfferingTypesV23(list) ?? list;
          writes.push({ key: KEYS.migrationOfferingV23, value: true });
        }
        if (!done24) {
          list = migrateOfferingTypesV24(list) ?? list;
          writes.push({ key: KEYS.migrationOfferingV24, value: true });
        }
        if (list !== latest) writes.push({ key: KEYS.offeringTypes, value: list });
        return { writes, result: list };
      });
      setTypes(result);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
    return subscribeExternalChanges((keys) => {
      if (keys.includes(KEYS.offeringTypes)) void reload();
    });
  }, [reload]);

  const save = useCallback(async (draft: OfferingTypeDraft, id?: string) => {
    const name = draft.name.trim();
    if (!name) return '헌금 명칭을 입력하세요.';
    const { result } = await transact<{ error: string | null; list: OfferingType[] }>(async (read) => {
      const latest = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? [];
      if (latest.some((t) => t.name === name && t.id !== id)) return { writes: [], result: { error: '같은 이름의 헌금 종류가 있습니다.', list: latest } };
      const clean: OfferingTypeDraft = {
        ...draft,
        name,
        quickAmounts: [...new Set(draft.quickAmounts.filter((n) => Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b),
      };
      const list = id ? latest.map((t) => (t.id === id ? { ...t, ...clean } : t)) : [...latest, { ...clean, id: newId() }];
      return { writes: [{ key: KEYS.offeringTypes, value: list }], result: { error: null, list } };
    });
    if (!result.error) setTypes(result.list);
    return result.error;
  }, []);

  const countUsage = useCallback(async (id: string) => {
    let used = 0;
    for (const y of await listDonationYears()) {
      used += ((await getItem<Donation[]>(donationKey(y))) ?? []).filter((d) => d.offeringTypeId === id).length;
    }
    return used;
  }, []);

  const remove = useCallback(async (id: string) => {
    // 사용 여부 확인과 삭제를 한 트랜잭션에서 처리해, 확인 직후 다른 창에서 헌금이 입력돼도 안전합니다.
    const { result } = await transact<{ kind: 'deleted'; list: OfferingType[] } | { kind: 'used'; count: number } | { kind: 'missing' }>(async (read) => {
      const latest = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? [];
      if (!latest.some((t) => t.id === id)) return { writes: [], result: { kind: 'missing' } };
      let used = 0;
      for (const y of await listDonationYears()) {
        used += ((await read<Donation[]>(donationKey(y))) ?? []).filter((d) => d.offeringTypeId === id).length;
      }
      if (used > 0) return { writes: [], result: { kind: 'used', count: used } };
      const list = latest.filter((t) => t.id !== id);
      return { writes: [{ key: KEYS.offeringTypes, value: list }], result: { kind: 'deleted', list } };
    });
    if (result.kind === 'deleted') {
      setTypes(result.list);
      return { kind: 'deleted' as const };
    }
    return result;
  }, []);

  const actions = useMemo(() => ({ save, countUsage, remove, reload }), [save, countUsage, remove, reload]);
  const activeTypes = useMemo(() => types.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder), [types]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const value = useMemo(() => ({ types, activeTypes, typeById, loaded, actions }), [types, activeTypes, typeById, loaded, actions]);
  return <OfferingCtx.Provider value={value}>{children}</OfferingCtx.Provider>;
}

export function useOfferingSelector<T>(selector: (s: OfferingState) => T): T {
  return useContextSelector(OfferingCtx, (s) => {
    if (!s) throw new Error('OfferingTypeProvider가 필요합니다.');
    return selector(s);
  });
}

export const useOfferingTypes = () => useOfferingSelector((s) => s.types);
export const useActiveOfferingTypes = () => useOfferingSelector((s) => s.activeTypes);
export const useOfferingTypeById = () => useOfferingSelector((s) => s.typeById);
export const useOfferingActions = () => useOfferingSelector((s) => s.actions);
