import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { nextAnonymousName } from '../services/domain/anonymous';
import { yearOf } from '../services/domain/dates';
import {
  buildDonation,
  findDuplicate,
  makeAudit,
  mergeDonation,
  REASON_MERGE,
  REASON_UNDO,
} from '../services/domain/donationOps';
import { newId, nowIso } from '../services/domain/ids';
import {
  AUDIT_KEY_RE,
  DONATION_KEY_RE,
  auditKey,
  donationKey,
  getItem,
  listDonationYears,
  transact,
  type Write,
} from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import type { AuditLog, Donation, DonationDraft, DuplicateResolution, SaveBatch } from './types';

const HISTORY_LIMIT = 10;

interface DonationActions {
  ensureYear(year: string): Promise<void>;
  ensureAuditYear(year: string): Promise<void>;
  /** 각 초안별 중복(동일 날짜+성도+종류) 기존 내역. 저장소 최신값 기준 */
  findDuplicates(drafts: DonationDraft[]): Promise<(Donation | undefined)[]>;
  saveBatch(drafts: DonationDraft[], resolution: DuplicateResolution): Promise<SaveBatch>;
  updateDonation(original: Donation, next: Donation, reason: string): Promise<void>;
  deleteDonation(target: Donation, reason: string): Promise<void>;
  undoLast(): Promise<SaveBatch | null>;
  reloadAll(): Promise<void>;
}

interface DonationState {
  shards: Record<string, Donation[]>;
  audits: Record<string, AuditLog[]>;
  years: string[];
  /** 이번 실행 중 저장한 묶음 (최신순, 메모리 전용) */
  history: SaveBatch[];
  actions: DonationActions;
}

const DonationCtx = createContext<DonationState | null>(null);

export function DonationProvider({ children }: { children: ReactNode }) {
  const [shards, setShards] = useState<Record<string, Donation[]>>({});
  const [audits, setAudits] = useState<Record<string, AuditLog[]>>({});
  const [years, setYears] = useState<string[]>([]);
  const [history, setHistory] = useState<SaveBatch[]>([]);
  const historyRef = useRef<SaveBatch[]>([]);
  historyRef.current = history;
  const loadedYears = useRef(new Set<string>());
  const loadedAuditYears = useRef(new Set<string>());

  /** 커밋된 쓰기 목록을 메모리 상태에 반영 */
  const applyWrites = useCallback((writes: Write[]) => {
    const dPatch: Record<string, Donation[] | null> = {};
    const aPatch: Record<string, AuditLog[] | null> = {};
    for (const w of writes) {
      const dy = DONATION_KEY_RE.exec(w.key)?.[1];
      if (dy) dPatch[dy] = (w.value as Donation[] | null) ?? null;
      const ay = AUDIT_KEY_RE.exec(w.key)?.[1];
      if (ay) aPatch[ay] = (w.value as AuditLog[] | null) ?? null;
    }
    const dKeys = Object.keys(dPatch);
    if (dKeys.length) {
      setShards((prev) => {
        const next = { ...prev };
        for (const y of dKeys) {
          if (dPatch[y] === null) delete next[y];
          else next[y] = dPatch[y]!;
          loadedYears.current.add(y);
        }
        return next;
      });
      setYears((prev) => {
        const set = new Set(prev);
        for (const y of dKeys) {
          if (dPatch[y] === null) set.delete(y);
          else set.add(y);
        }
        return [...set].sort();
      });
    }
    const aKeys = Object.keys(aPatch);
    if (aKeys.length) {
      setAudits((prev) => {
        const next = { ...prev };
        for (const y of aKeys) {
          if (aPatch[y] === null) delete next[y];
          else next[y] = aPatch[y]!;
          loadedAuditYears.current.add(y);
        }
        return next;
      });
    }
  }, []);

  const ensureYear = useCallback(async (year: string) => {
    if (loadedYears.current.has(year)) return;
    loadedYears.current.add(year);
    const list = (await getItem<Donation[]>(donationKey(year))) ?? [];
    // 불러오는 사이 저장이 먼저 반영됐다면(더 최신) 오래된 값으로 덮어쓰지 않습니다.
    setShards((prev) => (prev[year] ? prev : { ...prev, [year]: list }));
  }, []);

  const ensureAuditYear = useCallback(async (year: string) => {
    if (loadedAuditYears.current.has(year)) return;
    loadedAuditYears.current.add(year);
    const list = (await getItem<AuditLog[]>(auditKey(year))) ?? [];
    setAudits((prev) => (prev[year] ? prev : { ...prev, [year]: list }));
  }, []);

  const reloadAll = useCallback(async () => {
    loadedYears.current.clear();
    loadedAuditYears.current.clear();
    setShards({});
    setAudits({});
    setHistory([]);
    setYears(await listDonationYears());
  }, []);

  useEffect(() => {
    void listDonationYears().then(setYears);
    return subscribeExternalChanges(async (keys) => {
      const writes: Write[] = [];
      for (const k of keys) {
        const dy = DONATION_KEY_RE.exec(k)?.[1];
        const ay = AUDIT_KEY_RE.exec(k)?.[1];
        if ((dy && loadedYears.current.has(dy)) || (ay && loadedAuditYears.current.has(ay))) {
          writes.push({ key: k, value: await getItem(k) });
        }
      }
      applyWrites(writes);
      if (keys.some((k) => DONATION_KEY_RE.test(k))) setYears(await listDonationYears());
    });
  }, [applyWrites]);

  const findDuplicates = useCallback(async (drafts: DonationDraft[]) => {
    const cache = new Map<string, Donation[]>();
    const out: (Donation | undefined)[] = [];
    for (const d of drafts) {
      const y = yearOf(d.date);
      if (!cache.has(y)) cache.set(y, (await getItem<Donation[]>(donationKey(y))) ?? []);
      out.push(findDuplicate(cache.get(y)!, d));
    }
    return out;
  }, []);

  const saveBatch = useCallback(
    async (drafts: DonationDraft[], resolution: DuplicateResolution) => {
      if (drafts.length === 0) throw new Error('저장할 금액이 없습니다.');
      const date = drafts[0].date;
      const year = yearOf(date);
      const { writes, result } = await transact(async (read) => {
        const shard = [...((await read<Donation[]>(donationKey(year))) ?? [])];
        const logs = [...((await read<AuditLog[]>(auditKey(year))) ?? [])];
        const now = nowIso();
        const batch: SaveBatch = {
          batchId: newId(),
          savedAt: now,
          date,
          donorDisplayName: drafts[0].donorDisplayName,
          createdIds: [],
          mergedBefore: [],
          lines: [],
        };
        for (const d of drafts) {
          const dup = resolution === 'MERGE' ? findDuplicate(shard, d) : undefined;
          if (dup) {
            const merged = mergeDonation(dup, d);
            shard[shard.findIndex((x) => x.id === dup.id)] = merged;
            if (!batch.mergedBefore.some((b) => b.id === dup.id)) batch.mergedBefore.push(dup);
            logs.push(makeAudit('UPDATE', dup, merged, REASON_MERGE, now));
            batch.lines.push({ offeringTypeId: d.offeringTypeId, amount: d.amount, merged: true });
          } else {
            const created = buildDonation(d, newId(), now);
            shard.push(created);
            batch.createdIds.push(created.id);
            batch.lines.push({ offeringTypeId: d.offeringTypeId, amount: d.amount, merged: false });
          }
        }
        const w: Write[] = [{ key: donationKey(year), value: shard }];
        if (batch.mergedBefore.length) w.push({ key: auditKey(year), value: logs });
        return { writes: w, result: batch };
      });
      applyWrites(writes);
      setHistory((prev) => [result, ...prev].slice(0, HISTORY_LIMIT));
      return result;
    },
    [applyWrites],
  );

  const updateDonation = useCallback(
    async (original: Donation, next: Donation, reason: string) => {
      const oldYear = yearOf(original.date);
      const newYear = yearOf(next.date);
      const { writes } = await transact(async (read) => {
        const oldShard = [...((await read<Donation[]>(donationKey(oldYear))) ?? [])];
        const idx = oldShard.findIndex((d) => d.id === original.id);
        if (idx < 0) throw new Error('수정할 내역을 찾을 수 없습니다. 다른 창에서 변경되었을 수 있습니다.');
        const before = oldShard[idx];
        const after: Donation = { ...next, id: before.id, createdAt: before.createdAt };
        const logs = [...((await read<AuditLog[]>(auditKey(newYear))) ?? [])];
        logs.push(makeAudit('UPDATE', before, after, reason));
        const w: Write[] = [];
        if (oldYear === newYear) {
          oldShard[idx] = after;
          w.push({ key: donationKey(oldYear), value: oldShard });
        } else {
          // 연도 경계 이관: 이전 샤드에서 제거 → 새 샤드에 삽입 → 새 연도 감사 로그 기록
          oldShard.splice(idx, 1);
          const newShard = [...((await read<Donation[]>(donationKey(newYear))) ?? []), after];
          w.push({ key: donationKey(oldYear), value: oldShard }, { key: donationKey(newYear), value: newShard });
        }
        w.push({ key: auditKey(newYear), value: logs });
        return { writes: w, result: undefined };
      });
      applyWrites(writes);
    },
    [applyWrites],
  );

  const deleteDonation = useCallback(
    async (target: Donation, reason: string) => {
      const year = yearOf(target.date);
      const { writes } = await transact(async (read) => {
        const shard = [...((await read<Donation[]>(donationKey(year))) ?? [])];
        const idx = shard.findIndex((d) => d.id === target.id);
        if (idx < 0) throw new Error('삭제할 내역을 찾을 수 없습니다. 다른 창에서 변경되었을 수 있습니다.');
        const [before] = shard.splice(idx, 1);
        const logs = [...((await read<AuditLog[]>(auditKey(year))) ?? []), makeAudit('DELETE', before, null, reason)];
        return { writes: [{ key: donationKey(year), value: shard }, { key: auditKey(year), value: logs }], result: undefined };
      });
      applyWrites(writes);
    },
    [applyWrites],
  );

  const undoLast = useCallback(async () => {
    const batch = historyRef.current[0];
    if (!batch) return null;
    const batchYear = yearOf(batch.date);
    const { writes } = await transact(async (read) => {
      const now = nowIso();
      // 저장 후 [수정]으로 날짜(연도)가 바뀌었을 수 있으므로 저장 연도를 먼저, 나머지 연도를 뒤에 찾습니다.
      const years = [batchYear, ...(await listDonationYears()).filter((y) => y !== batchYear)];
      const shards = new Map<string, Donation[]>();
      for (const y of years) shards.set(y, [...((await read<Donation[]>(donationKey(y))) ?? [])]);
      const logs = new Map<string, AuditLog[]>();
      const touched = new Set<string>();
      const auditOf = async (y: string): Promise<AuditLog[]> => {
        if (!logs.has(y)) logs.set(y, [...((await read<AuditLog[]>(auditKey(y))) ?? [])]);
        return logs.get(y)!;
      };
      const locate = (id: string): { year: string; idx: number } | null => {
        for (const y of years) {
          const idx = shards.get(y)!.findIndex((d) => d.id === id);
          if (idx >= 0) return { year: y, idx };
        }
        return null;
      };
      for (const id of batch.createdIds) {
        const at = locate(id);
        if (!at) continue; // 이미 다른 경로로 삭제됨
        const [removed] = shards.get(at.year)!.splice(at.idx, 1);
        (await auditOf(at.year)).push(makeAudit('DELETE', removed, null, REASON_UNDO, now));
        touched.add(at.year);
      }
      for (const before of batch.mergedBefore) {
        const at = locate(before.id);
        if (!at) continue;
        const current = shards.get(at.year)![at.idx];
        (await auditOf(at.year)).push(makeAudit('UPDATE', current, before, REASON_UNDO, now));
        // 합산 전 상태(원래 날짜)로 복원: 연도가 달라졌다면 원래 연도 장부로 되돌립니다.
        const targetYear = yearOf(before.date);
        if (targetYear === at.year) shards.get(at.year)![at.idx] = before;
        else {
          shards.get(at.year)!.splice(at.idx, 1);
          shards.set(targetYear, [...(shards.get(targetYear) ?? []), before]);
          touched.add(targetYear);
        }
        touched.add(at.year);
      }
      const w: Write[] = [];
      for (const y of touched) {
        w.push({ key: donationKey(y), value: shards.get(y)! });
        if (logs.has(y)) w.push({ key: auditKey(y), value: logs.get(y)! });
      }
      return { writes: w, result: undefined };
    });
    applyWrites(writes);
    setHistory((prev) => prev.filter((b) => b.batchId !== batch.batchId));
    return batch;
  }, [applyWrites]);

  const actions = useMemo(
    () => ({ ensureYear, ensureAuditYear, findDuplicates, saveBatch, updateDonation, deleteDonation, undoLast, reloadAll }),
    [ensureYear, ensureAuditYear, findDuplicates, saveBatch, updateDonation, deleteDonation, undoLast, reloadAll],
  );
  const value = useMemo(() => ({ shards, audits, years, history, actions }), [shards, audits, years, history, actions]);
  return <DonationCtx.Provider value={value}>{children}</DonationCtx.Provider>;
}

export function useDonationSelector<T>(selector: (s: DonationState) => T): T {
  return useContextSelector(DonationCtx, (s) => {
    if (!s) throw new Error('DonationProvider가 필요합니다.');
    return selector(s);
  });
}

const EMPTY: never[] = [];
export const useDonationActions = () => useDonationSelector((s) => s.actions);
export const useShard = (year: string): Donation[] => useDonationSelector((s) => s.shards[year] ?? EMPTY);
/** 선택일 기준 다음 무명 표기명(`무명N`). 문자열만 구독하므로 번호가 바뀔 때만 리렌더됩니다. */
export const useNextAnonymousName = (date: string): string =>
  useDonationSelector((s) => nextAnonymousName(s.shards[yearOf(date)] ?? EMPTY, date));
export const useAllAudits = (): Record<string, AuditLog[]> => useDonationSelector((s) => s.audits);
export const useAuditShard =(year: string): AuditLog[] => useDonationSelector((s) => s.audits[year] ?? EMPTY);
export const useDonationYears = () => useDonationSelector((s) => s.years);
export const useAllShards = () => useDonationSelector((s) => s.shards);
export const useSaveHistory = () => useDonationSelector((s) => s.history);
