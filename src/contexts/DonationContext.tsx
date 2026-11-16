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
import { yearsToEvict } from '../services/domain/monthCache';
import {
  AUDIT_KEY_RE,
  DONATION_KEY_RE,
  auditKey,
  donationKey,
  getItem,
  listDonationKeys,
  listDonationYears,
  monthOfDate,
  monthsOfYear,
  monthWrite,
  findDuplicatesByIndex,
  transact,
  type Write,
} from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import type { AuditLog, Donation, DonationDraft, DuplicateResolution, SaveBatch } from './types';

const HISTORY_LIMIT = 10;
/** 메모리에 남겨 두는 헌금 연도 수(지금 화면이 쓰는 연도는 이 수와 상관없이 유지) */
const MAX_LOADED_YEARS = 3;

interface DonationActions {
  /** 지정한 달('YYYY-MM')의 헌금을 메모리로 불러옵니다(이미 있으면 건너뜀) */
  ensureMonths(yms: readonly string[]): Promise<void>;
  /** 화면이 쓰는 달의 연도를 '사용 중'으로 표시해 메모리에서 내려가지 않게 합니다. 반환 함수로 해제합니다. */
  pinMonths(yms: readonly string[]): () => void;
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
  /** 메모리에 불러온 달별 헌금('YYYY-MM' → 목록). 저장하면 해당 달의 배열만 교체됩니다. */
  months: Record<string, Donation[]>;
  /** reloadAll 때마다 1씩 올라가 화면이 필요한 달을 다시 불러오게 합니다. */
  epoch: number;
  audits: Record<string, AuditLog[]>;
  years: string[];
  /** 이번 실행 중 저장한 묶음 (최신순, 메모리 전용) */
  history: SaveBatch[];
  actions: DonationActions;
}

const DonationCtx = createContext<DonationState | null>(null);

export function DonationProvider({ children }: { children: ReactNode }) {
  const [months, setMonths] = useState<Record<string, Donation[]>>({});
  const [epoch, setEpoch] = useState(0);
  const [audits, setAudits] = useState<Record<string, AuditLog[]>>({});
  const [years, setYears] = useState<string[]>([]);
  const [history, setHistory] = useState<SaveBatch[]>([]);
  const historyRef = useRef<SaveBatch[]>([]);
  historyRef.current = history;
  // 메모리에 올라간 달 / 읽는 중인 달 / 읽는 동안 저장이 커밋되어 다시 읽어야 하는 달
  const loadedMonths = useRef(new Set<string>());
  const loadingMonths = useRef(new Set<string>());
  const staleMonths = useRef(new Set<string>());
  const loadedAuditYears = useRef(new Set<string>());
  // 연도별 '사용 중' 개수(화면이 쓰는 연도)와 마지막 사용 시각: 오래 쓰지 않은 연도부터 메모리에서 내립니다.
  const pins = useRef(new Map<string, number>());
  const lastUsed = useRef(new Map<string, number>());
  // reloadAll(복원·초기화) 이후 도착한 이전 읽기 결과를 버리기 위한 세대 번호
  const generation = useRef(0);
  // 연도 목록 새로 읽기는 가장 마지막에 시작한 것만 반영합니다(순서가 뒤바뀌어 오래된 목록이 덮어쓰는 것을 방지).
  const yearsToken = useRef(0);
  const refreshYears = useCallback(() => {
    const token = ++yearsToken.current;
    void listDonationYears()
      .then((list) => {
        if (token === yearsToken.current) setYears(list);
      })
      .catch(() => undefined);
  }, []);

  const evictOldYears = useCallback(() => {
    const loadingYears = new Set([...loadingMonths.current].map((m) => m.slice(0, 4)));
    const drop = new Set(yearsToEvict(loadedMonths.current, pins.current, lastUsed.current, loadingYears, MAX_LOADED_YEARS));
    if (drop.size === 0) return;
    for (const ym of [...loadedMonths.current]) if (drop.has(ym.slice(0, 4))) loadedMonths.current.delete(ym);
    setMonths((prev) => Object.fromEntries(Object.entries(prev).filter(([ym]) => !drop.has(ym.slice(0, 4)))));
  }, []);

  const pinMonths = useCallback(
    (yms: readonly string[]) => {
      const ys = [...new Set(yms.map((m) => m.slice(0, 4)))];
      for (const y of ys) {
        pins.current.set(y, (pins.current.get(y) ?? 0) + 1);
        lastUsed.current.set(y, Date.now());
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const y of ys) {
          pins.current.set(y, Math.max(0, (pins.current.get(y) ?? 1) - 1));
          lastUsed.current.set(y, Date.now());
        }
        evictOldYears();
      };
    },
    [evictOldYears],
  );

  /**
   * 커밋된 쓰기 목록을 메모리 상태에 반영합니다. 헌금은 달 단위로 보관하므로 쓰기가 닿은 달의 배열만 교체합니다
   * (연도 전체를 다시 만들지 않음). 메모리에 없는 달은 건드리지 않고(불러올 때 최신 값을 읽음),
   * 읽는 중인 달이면 다시 읽도록 표시합니다.
   */
  const applyWrites = useCallback((writes: Write[]) => {
    const monthPatch = new Map<string, Donation[]>();
    const aPatch: Record<string, AuditLog[] | null> = {};
    for (const w of writes) {
      const dm = DONATION_KEY_RE.exec(w.key)?.[1];
      if (dm) monthPatch.set(dm, (w.value as Donation[] | null) ?? []);
      const ay = AUDIT_KEY_RE.exec(w.key)?.[1];
      if (ay) aPatch[ay] = (w.value as AuditLog[] | null) ?? null;
    }
    if (monthPatch.size) {
      const apply = new Map<string, Donation[]>();
      for (const [ym, list] of monthPatch) {
        if (loadingMonths.current.has(ym)) staleMonths.current.add(ym);
        if (loadedMonths.current.has(ym)) apply.set(ym, list);
      }
      if (apply.size) {
        setMonths((prev) => {
          const next = { ...prev };
          for (const [ym, list] of apply) next[ym] = list;
          return next;
        });
      }
      // 헌금이 있는 연도 목록: 추가는 바로 반영하고, 달이 비워진 경우에만 저장소에서 다시 읽습니다.
      const added = [...monthPatch].filter(([, l]) => l.length > 0).map(([ym]) => ym.slice(0, 4));
      if (added.length) setYears((prev) => (added.every((y) => prev.includes(y)) ? prev : [...new Set([...prev, ...added])].sort()));
      if ([...monthPatch.values()].some((l) => l.length === 0)) refreshYears();
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
  }, [refreshYears]);

  const ensureMonths = useCallback(async (yms: readonly string[]) => {
    await Promise.all(
      yms.map(async (ym) => {
        lastUsed.current.set(ym.slice(0, 4), Date.now()); // 방금 요청한 연도는 가장 최근에 쓴 것으로 칩니다.
        if (loadedMonths.current.has(ym) || loadingMonths.current.has(ym)) return;
        const gen = generation.current;
        loadingMonths.current.add(ym);
        try {
          let list: Donation[];
          do {
            staleMonths.current.delete(ym);
            list = (await getItem<Donation[]>(donationKey(ym))) ?? [];
            // 읽는 사이 저장이 커밋됐다면(staleMonths) 오래된 값이 될 수 있으므로 다시 읽습니다.
          } while (staleMonths.current.has(ym) && gen === generation.current);
          if (gen !== generation.current) return; // 읽는 동안 복원·초기화(reloadAll)가 일어났으면 이 결과는 버립니다.
          loadedMonths.current.add(ym);
          setMonths((prev) => ({ ...prev, [ym]: list }));
        } catch {
          // 읽기 실패: 다음에 다시 시도할 수 있도록 '읽는 중' 표시만 지웁니다(화면에는 빈 달로 보임).
        } finally {
          if (gen === generation.current) loadingMonths.current.delete(ym);
        }
      }),
    );
    evictOldYears();
  }, [evictOldYears]);

  const ensureYear = useCallback((year: string) => ensureMonths(monthsOfYear(year)), [ensureMonths]);

  const ensureAuditYear = useCallback(async (year: string) => {
    if (loadedAuditYears.current.has(year)) return;
    loadedAuditYears.current.add(year);
    const list = (await getItem<AuditLog[]>(auditKey(year))) ?? [];
    setAudits((prev) => (prev[year] ? prev : { ...prev, [year]: list }));
  }, []);

  const reloadAll = useCallback(async () => {
    generation.current++;
    loadedMonths.current.clear();
    loadingMonths.current.clear();
    staleMonths.current.clear();
    loadedAuditYears.current.clear();
    lastUsed.current.clear();
    setMonths({});
    setEpoch((e) => e + 1);
    setAudits({});
    setHistory([]);
    setYears(await listDonationYears());
  }, []);

  useEffect(() => {
    refreshYears();
    return subscribeExternalChanges(async (keys) => {
      const writes: Write[] = [];
      for (const k of keys) {
        const dm = DONATION_KEY_RE.exec(k)?.[1];
        const ay = AUDIT_KEY_RE.exec(k)?.[1];
        if ((dm && (loadedMonths.current.has(dm) || loadingMonths.current.has(dm))) || (ay && loadedAuditYears.current.has(ay))) {
          writes.push({ key: k, value: await getItem(k) });
        }
      }
      applyWrites(writes);
      if (keys.some((k) => DONATION_KEY_RE.test(k))) refreshYears();
    });
  }, [applyWrites, refreshYears]);

  const findDuplicates = useCallback(async (drafts: DonationDraft[]) => {
    // 행 테이블이 준비돼 있으면 색인으로 찾고(월 전체를 읽지 않음), 아니면 월 배열에서 찾습니다.
    const byIndex = await findDuplicatesByIndex(drafts);
    if (byIndex) return byIndex;
    const cache = new Map<string, Donation[]>();
    const out: (Donation | undefined)[] = [];
    for (const d of drafts) {
      const ym = monthOfDate(d.date);
      if (!cache.has(ym)) cache.set(ym, (await getItem<Donation[]>(donationKey(ym))) ?? []);
      out.push(findDuplicate(cache.get(ym)!, d));
    }
    return out;
  }, []);

  const saveBatch = useCallback(
    async (drafts: DonationDraft[], resolution: DuplicateResolution) => {
      if (drafts.length === 0) throw new Error('저장할 금액이 없습니다.');
      const date = drafts[0].date;
      const year = yearOf(date);
      const ym = monthOfDate(date);
      const { writes, result } = await transact(async (read) => {
        const shard = [...((await read<Donation[]>(donationKey(ym))) ?? [])];
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
        const w: Write[] = [monthWrite(ym, shard)];
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
      const oldYm = monthOfDate(original.date);
      const newYm = monthOfDate(next.date);
      const newYear = yearOf(next.date);
      const { writes } = await transact(async (read) => {
        const oldShard = [...((await read<Donation[]>(donationKey(oldYm))) ?? [])];
        const idx = oldShard.findIndex((d) => d.id === original.id);
        if (idx < 0) throw new Error('수정할 내역을 찾을 수 없습니다. 다른 창에서 변경되었을 수 있습니다.');
        const before = oldShard[idx];
        const after: Donation = { ...next, id: before.id, createdAt: before.createdAt };
        const logs = [...((await read<AuditLog[]>(auditKey(newYear))) ?? [])];
        logs.push(makeAudit('UPDATE', before, after, reason));
        const w: Write[] = [];
        if (oldYm === newYm) {
          oldShard[idx] = after;
          w.push(monthWrite(oldYm, oldShard));
        } else {
          // 월(연도) 경계 이관: 이전 달에서 제거 → 새 달에 삽입 → 새 연도 감사 로그 기록
          oldShard.splice(idx, 1);
          const newShard = [...((await read<Donation[]>(donationKey(newYm))) ?? []), after];
          w.push(monthWrite(oldYm, oldShard), monthWrite(newYm, newShard));
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
      const ym = monthOfDate(target.date);
      const { writes } = await transact(async (read) => {
        const shard = [...((await read<Donation[]>(donationKey(ym))) ?? [])];
        const idx = shard.findIndex((d) => d.id === target.id);
        if (idx < 0) throw new Error('삭제할 내역을 찾을 수 없습니다. 다른 창에서 변경되었을 수 있습니다.');
        const [before] = shard.splice(idx, 1);
        const logs = [...((await read<AuditLog[]>(auditKey(year))) ?? []), makeAudit('DELETE', before, null, reason)];
        return { writes: [monthWrite(ym, shard), { key: auditKey(year), value: logs }], result: undefined };
      });
      applyWrites(writes);
    },
    [applyWrites],
  );

  const undoLast = useCallback(async () => {
    const batch = historyRef.current[0];
    if (!batch) return null;
    const batchYm = monthOfDate(batch.date);
    const { writes } = await transact(async (read) => {
      const now = nowIso();
      // 저장 후 [수정]으로 날짜(월)가 바뀌었을 수 있으므로 저장한 달을 먼저 읽고,
      // 거기서 찾지 못한 내역이 있을 때만 나머지 달을 읽습니다(대부분 저장한 달 하나만 읽음).
      const months: string[] = [batchYm];
      const shards = new Map<string, Donation[]>();
      shards.set(batchYm, [...((await read<Donation[]>(donationKey(batchYm))) ?? [])]);
      let loadedAll = false;
      const loadOthers = async (): Promise<void> => {
        if (loadedAll) return;
        loadedAll = true;
        for (const k of await listDonationKeys()) {
          const m = DONATION_KEY_RE.exec(k)![1];
          if (shards.has(m)) continue;
          months.push(m);
          shards.set(m, [...((await read<Donation[]>(k)) ?? [])]);
        }
      };
      const logs = new Map<string, AuditLog[]>();
      const touched = new Set<string>();
      const auditOf = async (ym: string): Promise<AuditLog[]> => {
        const y = ym.slice(0, 4);
        if (!logs.has(y)) logs.set(y, [...((await read<AuditLog[]>(auditKey(y))) ?? [])]);
        return logs.get(y)!;
      };
      const find = (id: string): { ym: string; idx: number } | null => {
        for (const m of months) {
          const idx = shards.get(m)!.findIndex((d) => d.id === id);
          if (idx >= 0) return { ym: m, idx };
        }
        return null;
      };
      const locate = async (id: string): Promise<{ ym: string; idx: number } | null> => {
        const hit = find(id);
        if (hit || loadedAll) return hit;
        await loadOthers();
        return find(id);
      };
      for (const id of batch.createdIds) {
        const at = await locate(id);
        if (!at) continue; // 이미 다른 경로로 삭제됨
        const [removed] = shards.get(at.ym)!.splice(at.idx, 1);
        (await auditOf(at.ym)).push(makeAudit('DELETE', removed, null, REASON_UNDO, now));
        touched.add(at.ym);
      }
      for (const before of batch.mergedBefore) {
        const at = await locate(before.id);
        if (!at) continue;
        const current = shards.get(at.ym)![at.idx];
        (await auditOf(at.ym)).push(makeAudit('UPDATE', current, before, REASON_UNDO, now));
        // 합산 전 상태(원래 날짜)로 복원: 달이 달라졌다면 원래 달의 장부로 되돌립니다.
        const targetYm = monthOfDate(before.date);
        if (targetYm === at.ym) shards.get(at.ym)![at.idx] = before;
        else {
          shards.get(at.ym)!.splice(at.idx, 1);
          shards.set(targetYm, [...(shards.get(targetYm) ?? (await read<Donation[]>(donationKey(targetYm))) ?? []), before]);
          touched.add(targetYm);
        }
        touched.add(at.ym);
      }
      const w: Write[] = [];
      for (const m of touched) w.push(monthWrite(m, shards.get(m)!));
      for (const [y, l] of logs) w.push({ key: auditKey(y), value: l });
      return { writes: w, result: undefined };
    });
    applyWrites(writes);
    setHistory((prev) => prev.filter((b) => b.batchId !== batch.batchId));
    return batch;
  }, [applyWrites]);

  const actions = useMemo(
    () => ({ ensureMonths, pinMonths, ensureYear, ensureAuditYear, findDuplicates, saveBatch, updateDonation, deleteDonation, undoLast, reloadAll }),
    [ensureMonths, pinMonths, ensureYear, ensureAuditYear, findDuplicates, saveBatch, updateDonation, deleteDonation, undoLast, reloadAll],
  );
  const value = useMemo(() => ({ months, epoch, audits, years, history, actions }), [months, epoch, audits, years, history, actions]);
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
/** 선택일 기준 다음 무명 표기명(`무명N`). 문자열만 구독하므로 번호가 바뀔 때만 리렌더됩니다. */
export const useNextAnonymousName = (date: string): string =>
  useDonationSelector((s) => nextAnonymousName(s.months[monthOfDate(date)] ?? EMPTY, date));

/**
 * 지정한 달('YYYY-MM')들의 헌금을 이어 붙인 배열. 필요한 달을 불러오고(없으면), 그 달 배열이 바뀐 때만 새 배열을 만듭니다
 * (달이 하나면 배열을 그대로 돌려줌). 다른 달에 저장해도 이 배열은 그대로라서 집계가 다시 계산되지 않습니다.
 */
export function useDonationMonths(yms: readonly string[]): Donation[] {
  const actions = useDonationActions();
  const epoch = useDonationSelector((s) => s.epoch);
  const months = useDonationSelector((s) => s.months);
  const key = yms.join(',');
  useEffect(() => {
    const list = key ? key.split(',') : [];
    const unpin = actions.pinMonths(list); // 이 화면이 쓰는 동안은 해당 연도를 메모리에서 내리지 않음
    void actions.ensureMonths(list);
    return unpin;
  }, [actions, key, epoch]);
  const parts = yms.map((m) => months[m] ?? EMPTY);
  const memo = useRef<{ parts: Donation[][]; value: Donation[] } | null>(null);
  const prev = memo.current;
  if (!prev || prev.parts.length !== parts.length || parts.some((p, i) => p !== prev.parts[i])) {
    memo.current = { parts, value: parts.length === 1 ? parts[0] : parts.flat() };
  }
  return memo.current!.value;
}
export const useAllAudits = (): Record<string, AuditLog[]> => useDonationSelector((s) => s.audits);
export const useAuditShard =(year: string): AuditLog[] => useDonationSelector((s) => s.audits[year] ?? EMPTY);
export const useDonationYears = () => useDonationSelector((s) => s.years);
export const useDonationMonthsRecord = () => useDonationSelector((s) => s.months);
export const useSaveHistory = () => useDonationSelector((s) => s.history);
