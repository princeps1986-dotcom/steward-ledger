import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { newId } from '../services/domain/ids';
import { DEFAULT_OFFERING_TYPES, type OfferingTypeDraft } from '../services/domain/offeringDefaults';
import { isNotAllowed } from '../services/auth/access';
import { countDonationsOfType, getItem, KEYS, transact } from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import type { OfferingType } from './types';

export type { OfferingTypeDraft };

interface OfferingActions {
  save(draft: OfferingTypeDraft, id?: string): Promise<string | null>;
  /** 이 헌금 종류로 입력된 헌금 내역 수(모든 연도). 0이면 삭제할 수 있습니다. */
  countUsage(id: string): Promise<number>;
  /** 입력된 헌금이 없을 때만 삭제합니다. 삭제하면 'deleted', 입력된 헌금이 있으면 사용 건수, 없는 종류면 'missing'. */
  remove(id: string): Promise<{ kind: 'deleted' } | { kind: 'used'; count: number } | { kind: 'missing' }>;
  /** 주어진 id 순서대로 정렬 순서를 1..n으로 다시 매깁니다(목록에 없는 종류는 뒤에 그대로 이어 붙임). */
  reorder(ids: readonly string[]): Promise<void>;
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
      try {
        const { result } = await transact(async (read) => {
          const again = await read<OfferingType[]>(KEYS.offeringTypes);
          if (again) return { writes: [], result: again };
          const seeded = DEFAULT_OFFERING_TYPES.map((t) => ({ ...t, id: newId() }));
          return { writes: [{ key: KEYS.offeringTypes, value: seeded }], result: seeded };
        }, { markDirty: false });
        setTypes(result);
      } catch (e) {
        if (!isNotAllowed(e)) throw e;
        setTypes([]); // 저장 권한이 없는 역할(열람자)은 기본값을 만들지 않고 빈 목록으로 둡니다(관리자가 처음 쓸 때 만들어짐).
      }
    } else {
      setTypes(stored);
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
    return countDonationsOfType(id);
  }, []);

  const remove = useCallback(async (id: string) => {
    // 사용 여부 확인과 삭제를 한 트랜잭션에서 처리해, 확인 직후 다른 창에서 헌금이 입력돼도 안전합니다.
    const { result } = await transact<{ kind: 'deleted'; list: OfferingType[] } | { kind: 'used'; count: number } | { kind: 'missing' }>(async (read) => {
      const latest = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? [];
      if (!latest.some((t) => t.id === id)) return { writes: [], result: { kind: 'missing' } };
      const used = await countDonationsOfType(id);
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

  const reorder = useCallback(async (ids: readonly string[]) => {
    const { result } = await transact<OfferingType[]>(async (read) => {
      const latest = (await read<OfferingType[]>(KEYS.offeringTypes)) ?? [];
      const byId = new Map(latest.map((t) => [t.id, t]));
      const first = ids.flatMap((id) => byId.get(id) ?? []);
      const rest = latest.filter((t) => !ids.includes(t.id)).sort((a, b) => a.sortOrder - b.sortOrder);
      const list = [...first, ...rest].map((t, i) => ({ ...t, sortOrder: i + 1 }));
      return { writes: [{ key: KEYS.offeringTypes, value: list }], result: list };
    });
    setTypes(result);
  }, []);

  const actions = useMemo(() => ({ save, countUsage, remove, reorder, reload }), [save, countUsage, remove, reorder, reload]);
  const activeTypes = useMemo(() => types.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder), [types]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const value = useMemo(() => ({ types, activeTypes, typeById, loaded, actions }), [types, activeTypes, typeById, loaded, actions]);
  return <OfferingCtx.Provider value={value}>{children}</OfferingCtx.Provider>;
}

function useOfferingSelector<T>(selector: (s: OfferingState) => T): T {
  return useContextSelector(OfferingCtx, (s) => {
    if (!s) throw new Error('OfferingTypeProvider가 필요합니다.');
    return selector(s);
  });
}

export const useOfferingTypes = () => useOfferingSelector((s) => s.types);
export const useActiveOfferingTypes = () => useOfferingSelector((s) => s.activeTypes);
export const useOfferingTypeById = () => useOfferingSelector((s) => s.typeById);
export const useOfferingActions = () => useOfferingSelector((s) => s.actions);
