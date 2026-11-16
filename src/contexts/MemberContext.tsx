import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { nowIso } from '../services/domain/ids';
import { applyMemberSave, canDeactivate, type MemberDraft, type MemberSaveResult } from '../services/domain/memberRules';
import { clearLegacyPosition } from '../services/domain/positions';
import { getItem, KEYS, transact } from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import type { Member } from './types';

interface MemberActions {
  saveMember(draft: MemberDraft, editingId?: string): Promise<MemberSaveResult>;
  /** Soft Delete / 복구. 실패 시 오류 메시지 반환 */
  setActive(id: string, active: boolean): Promise<string | null>;
  /** 일괄 가져오기 결과 전체 반영 */
  replaceMembers(build: (latest: Member[]) => Member[]): Promise<void>;
  reload(): Promise<void>;
}

interface MemberState {
  members: Member[];
  memberById: Map<string, Member>;
  loaded: boolean;
  actions: MemberActions;
}

const MemberCtx = createContext<MemberState | null>(null);

export function MemberProvider({ children }: { children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    // v2.15: 이전 기본값 직분 '성도'를 직분 없음으로 1회 정리
    if ((await getItem<boolean>(KEYS.migrationPositionV25)) !== true) {
      await transact(async (read) => {
        const list = (await read<Member[]>(KEYS.members)) ?? [];
        const cleaned = clearLegacyPosition(list);
        const writes: { key: string; value: unknown }[] = [{ key: KEYS.migrationPositionV25, value: true }];
        if (cleaned) writes.push({ key: KEYS.members, value: cleaned });
        return { writes, result: null };
      });
    }
    setMembers((await getItem<Member[]>(KEYS.members)) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
    return subscribeExternalChanges((keys) => {
      if (keys.includes(KEYS.members)) void reload();
    });
  }, [reload]);

  const saveMember = useCallback(async (draft: MemberDraft, editingId?: string) => {
    const { result } = await transact(async (read) => {
      const latest = (await read<Member[]>(KEYS.members)) ?? [];
      const res = applyMemberSave(latest, draft, editingId);
      return { writes: res.ok ? [{ key: KEYS.members, value: res.members }] : [], result: res };
    });
    if (result.ok) setMembers(result.members);
    return result;
  }, []);

  const setActive = useCallback(async (id: string, active: boolean) => {
    const { result } = await transact<{ error: string | null; list: Member[] }>(async (read) => {
      const latest = (await read<Member[]>(KEYS.members)) ?? [];
      const m = latest.find((x) => x.id === id);
      if (!m) return { writes: [], result: { error: '성도를 찾을 수 없습니다.', list: latest } };
      const err = active ? null : canDeactivate(latest, m);
      if (err) return { writes: [], result: { error: err, list: latest } };
      const list = latest.map((x) => (x.id === id ? { ...x, isActive: active, updatedAt: nowIso() } : x));
      return { writes: [{ key: KEYS.members, value: list }], result: { error: null, list } };
    });
    if (!result.error) setMembers(result.list);
    return result.error;
  }, []);

  const replaceMembers = useCallback(async (build: (latest: Member[]) => Member[]) => {
    const { result } = await transact(async (read) => {
      const list = build((await read<Member[]>(KEYS.members)) ?? []);
      return { writes: [{ key: KEYS.members, value: list }], result: list };
    });
    setMembers(result);
  }, []);

  const actions = useMemo(() => ({ saveMember, setActive, replaceMembers, reload }), [saveMember, setActive, replaceMembers, reload]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const value = useMemo(() => ({ members, memberById, loaded, actions }), [members, memberById, loaded, actions]);
  return <MemberCtx.Provider value={value}>{children}</MemberCtx.Provider>;
}

export function useMemberSelector<T>(selector: (s: MemberState) => T): T {
  return useContextSelector(MemberCtx, (s) => {
    if (!s) throw new Error('MemberProvider가 필요합니다.');
    return selector(s);
  });
}

export const useMembers = () => useMemberSelector((s) => s.members);
export const useMemberById = () => useMemberSelector((s) => s.memberById);
export const useMemberActions = () => useMemberSelector((s) => s.actions);
