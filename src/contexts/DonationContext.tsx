import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createContext, useContextSelector } from 'use-context-selector';
import { nextAnonymousName, uniqueAnonymousName } from '../services/domain/anonymous';
import { assertNotRestoring } from '../services/backup/backupBusy';
import { yearOf } from '../services/domain/dates';
import {
  applyRowOps,
  buildDonation,
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
  auditAppend,
  auditKey,
  findDonationById,
  findDuplicateRow,
  getItem,
  listDonationYears,
  monthOfDate,
  monthsOfYear,
  readDay,
  readMonth,
  readRow,
  rowWrite,
  transact,
  type RowOps,
  type Write,
} from '../services/storage/storageService';
import { subscribeExternalChanges } from '../services/storage/tabSyncChannel';
import type { AuditLog, Donation, DonationDraft, DuplicateResolution, SaveBatch } from './types';

const HISTORY_LIMIT = 10;
/**
 * 메모리에 남겨 두는 헌금 건수. 행당 약 0.22KB(문자열 공유 후 실측, 연 26만 건에서 약 58MB 증가)이므로 약 110MB.
 * 새 연도를 읽은 뒤에 비우므로 읽는 동안에는 연 한 해치(26만 건 ≈ 60MB)만큼 더 올라갑니다. 지금 화면이 쓰는 연도는 이 수와 상관없이 유지
 */
const MAX_LOADED_ROWS = 500_000;
/** 화면이 연도를 놓았을 때(예: 보고서에서 입력 화면으로 이동) 남겨 두는 건수. 큰 연도를 바로 내려 메모리를 돌려줍니다. */
const IDLE_LOADED_ROWS = 100_000;

interface DonationActions {
  /** 지정한 달('YYYY-MM')의 헌금을 메모리로 불러옵니다(이미 있으면 건너뜀) */
  ensureMonths(yms: readonly string[]): Promise<void>;
  /** 화면이 쓰는 달의 연도를 '사용 중'으로 표시해 메모리에서 내려가지 않게 합니다. 반환 함수로 해제합니다. */
  pinMonths(yms: readonly string[]): () => void;
  ensureYear(year: string): Promise<void>;
  ensureAuditYear(year: string): Promise<void>;
  /** 각 초안별 중복(동일 날짜+성도+종류) 기존 내역. 저장소 최신값 기준 */
  findDuplicates(drafts: DonationDraft[]): Promise<(Donation | undefined)[]>;
  /** label: 복구하기·입력 이력에 보일 묶음 이름(없으면 첫 줄의 성도 이름). 여러 명을 한 묶음으로 저장할 때 씀 */
  saveBatch(drafts: DonationDraft[], resolution: DuplicateResolution, label?: string): Promise<SaveBatch>;
  updateDonation(original: Donation, next: Donation, reason: string): Promise<void>;
  deleteDonation(target: Donation, reason: string): Promise<void>;
  undoLast(): Promise<SaveBatch | null>;
  reloadAll(): Promise<void>;
}

interface DonationState {
  /** 메모리에 불러온 달별 헌금('YYYY-MM' → 목록). 저장하면 해당 달의 목록만 바뀝니다. */
  months: Record<string, Donation[]>;
  /** reloadAll 때마다 1씩 올라가 화면이 필요한 달을 다시 불러오게 합니다. */
  epoch: number;
  /** 달별 변경 횟수(메모리에 올리지 않은 달도 포함). 달을 직접 읽는 화면(전체 입력 내역)이 다시 읽을 달을 알아내는 데 씁니다. */
  monthVersions: Record<string, number>;
  audits: Record<string, AuditLog[]>;
  years: string[];
  /** 이번 실행 중 저장한 묶음 (최신순, 메모리 전용) */
  history: SaveBatch[];
  /** 읽기에 실패한 달('YYYY-MM'). 다시 읽어 성공하면 빠집니다(화면이 빈 달을 0원으로 보여 주지 않고 실패를 알리도록). */
  failedMonths: Record<string, true>;
  actions: DonationActions;
}

const DonationCtx = createContext<DonationState | null>(null);

export function DonationProvider({ children, maxLoadedRows = MAX_LOADED_ROWS }: { children: ReactNode; maxLoadedRows?: number }) {
  const [months, setMonths] = useState<Record<string, Donation[]>>({});
  const [epoch, setEpoch] = useState(0);
  const [monthVersions, setMonthVersions] = useState<Record<string, number>>({});
  const bumpVersions = useCallback((yms: Iterable<string>) => {
    setMonthVersions((prev) => {
      const next = { ...prev };
      for (const ym of yms) next[ym] = (next[ym] ?? 0) + 1;
      return next;
    });
  }, []);
  const [audits, setAudits] = useState<Record<string, AuditLog[]>>({});
  const [years, setYears] = useState<string[]>([]);
  const [history, setHistory] = useState<SaveBatch[]>([]);
  const [failedMonths, setFailedMonths] = useState<Record<string, true>>({});
  const historyRef = useRef<SaveBatch[]>([]);
  historyRef.current = history;
  // 메모리에 올라간 달 / 읽는 중인 달 / 읽는 동안 저장이 커밋되어 다시 읽어야 하는 달
  const loadedMonths = useRef(new Set<string>());
  // 달별로 읽어 둔 건수(내릴 연도를 정하는 용도라 이후의 소수 추가·삭제는 반영하지 않는 근사값)
  const monthRows = useRef(new Map<string, number>());
  const loadingMonths = useRef(new Set<string>());
  const staleMonths = useRef(new Set<string>());
  const loadedAuditYears = useRef(new Set<string>());
  // 이력을 읽는 중인 연도 / 읽는 사이 이력이 바뀌어 다시 읽어야 하는 연도
  const loadingAuditYears = useRef(new Set<string>());
  const staleAuditYears = useRef(new Set<string>());
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

  const evictOldYears = useCallback((budget = maxLoadedRows) => {
    const loadingYears = new Set([...loadingMonths.current].map((m) => m.slice(0, 4)));
    const drop = new Set(yearsToEvict(monthRows.current, pins.current, lastUsed.current, loadingYears, Math.min(budget, maxLoadedRows)));
    if (drop.size === 0) return;
    for (const ym of [...loadedMonths.current]) {
      if (!drop.has(ym.slice(0, 4))) continue;
      loadedMonths.current.delete(ym);
      monthRows.current.delete(ym);
    }
    setMonths((prev) => Object.fromEntries(Object.entries(prev).filter(([ym]) => !drop.has(ym.slice(0, 4)))));
  }, [maxLoadedRows]);

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
        evictOldYears(IDLE_LOADED_ROWS);
      };
    },
    [evictOldYears, maxLoadedRows],
  );

  /**
   * 커밋된 쓰기 목록을 메모리 상태에 반영합니다. 헌금은 달 단위로 보관하므로 쓰기가 닿은 달의 목록만 고칩니다
   * (연도 전체를 다시 만들지 않음). 행 단위 변경은 그 행만 반영하고, 달 전체 교체는 목록을 바꿉니다.
   * 메모리에 없는 달은 건드리지 않고(불러올 때 최신 값을 읽음), 읽는 중인 달이면 다시 읽도록 표시합니다.
   */
  const applyWrites = useCallback((writes: Write[]) => {
    const monthPatch = new Map<string, ((list: Donation[]) => Donation[])[]>();
    const addedYears = new Set<string>();
    let maybeEmptied = false;
    const aPatch: Record<string, AuditLog[] | null> = {}; // 그 해 전체 교체
    const aAppend: Record<string, AuditLog[]> = {}; // 그 해에 덧붙인 행
    for (const w of writes) {
      const dm = DONATION_KEY_RE.exec(w.key)?.[1];
      if (dm) {
        const fns = monthPatch.get(dm) ?? [];
        if (w.rowOps) {
          const { puts, deletes } = w.rowOps;
          fns.push((l) => applyRowOps(l, puts, deletes));
          if (puts.length) addedYears.add(dm.slice(0, 4));
          if (deletes.length) maybeEmptied = true;
        } else {
          const list = (w.value as Donation[] | null) ?? [];
          fns.push(() => list);
          if (list.length) addedYears.add(dm.slice(0, 4));
          else maybeEmptied = true;
        }
        monthPatch.set(dm, fns);
      }
      const ay = AUDIT_KEY_RE.exec(w.key)?.[1];
      if (ay) {
        if (loadingAuditYears.current.has(ay)) staleAuditYears.current.add(ay);
        if (w.auditPuts) (aAppend[ay] ??= []).push(...w.auditPuts);
        else {
          aPatch[ay] = (w.value as AuditLog[] | null) ?? null;
          delete aAppend[ay];
        }
      }
    }
    if (monthPatch.size) {
      bumpVersions(monthPatch.keys());
      const apply = new Map<string, ((list: Donation[]) => Donation[])[]>();
      for (const [ym, fns] of monthPatch) {
        if (loadingMonths.current.has(ym)) staleMonths.current.add(ym);
        if (loadedMonths.current.has(ym)) apply.set(ym, fns);
      }
      if (apply.size) {
        setMonths((prev) => {
          const next = { ...prev };
          for (const [ym, fns] of apply) next[ym] = fns.reduce((l, f) => f(l), prev[ym] ?? []);
          return next;
        });
      }
      // 헌금이 있는 연도 목록: 추가는 바로 반영하고, 달이 비워졌을 수 있는 경우에만 저장소에서 다시 읽습니다.
      if (addedYears.size) setYears((prev) => ([...addedYears].every((y) => prev.includes(y)) ? prev : [...new Set([...prev, ...addedYears])].sort()));
      if (maybeEmptied) refreshYears();
    }
    const aKeys = Object.keys(aPatch);
    for (const y of aKeys) loadedAuditYears.current.add(y);
    // 덧붙이기는 메모리에 올라간 연도에만 반영합니다(안 올라간 연도는 불러올 때 최신 값을 읽음).
    const appendYears = Object.keys(aAppend);
    if (aKeys.length || appendYears.length) {
      setAudits((prev) => {
        const next = { ...prev };
        for (const y of aKeys) {
          if (aPatch[y] === null) delete next[y];
          else next[y] = aPatch[y]!;
        }
        for (const y of appendYears) if (next[y]) next[y] = [...next[y], ...aAppend[y]];
        return next;
      });
    }
  }, [bumpVersions, refreshYears]);

  const ensureMonths = useCallback(async (yms: readonly string[]) => {
    const gen = generation.current;
    const todo: string[] = [];
    for (const ym of yms) {
      lastUsed.current.set(ym.slice(0, 4), Date.now()); // 방금 요청한 연도는 가장 최근에 쓴 것으로 칩니다.
      if (loadedMonths.current.has(ym) || loadingMonths.current.has(ym) || todo.includes(ym)) continue;
      loadingMonths.current.add(ym);
      todo.push(ym);
    }
    if (todo.length === 0) return;
    // 달들을 동시에 읽고(측정: 연 26만 건에서 차례로 읽는 것보다 약 25% 빠르고 최대 메모리는 같음) 화면에는 한 번에 반영합니다
    // (달마다 반영하면 보고서가 그때마다 다시 집계됨).
    const got = new Map<string, Donation[]>();
    try {
      await Promise.all(
        todo.map(async (ym) => {
          // 읽는 사이 저장이 커밋됐다면(staleMonths) 오래된 값이 될 수 있으므로 다시 읽습니다.
          do {
            staleMonths.current.delete(ym);
            got.set(ym, await readMonth(ym));
          } while (staleMonths.current.has(ym) && gen === generation.current);
        }),
      );
      if (gen !== generation.current) return; // 읽는 동안 복원·초기화(reloadAll)가 일어났으면 이 결과는 버립니다.
      // 읽기를 마친 뒤 반영하기 전에 바뀐 달은 그 달만 다시 읽습니다.
      for (let again = todo.filter((ym) => staleMonths.current.has(ym)); again.length && gen === generation.current; again = todo.filter((ym) => staleMonths.current.has(ym))) {
        for (const ym of again) {
          staleMonths.current.delete(ym);
          got.set(ym, await readMonth(ym));
        }
      }
    } catch {
      // 읽기 실패: 읽은 달까지만 반영하고, 나머지는 다음에 다시 시도할 수 있도록 '읽는 중' 표시만 지웁니다(화면에는 빈 달로 보임).
    }
    if (gen !== generation.current) return;
    // 여기부터 반영까지 기다리는 곳이 없어 사이에 다른 저장이 끼어들지 않습니다.
    for (const [ym, list] of got) {
      if (staleMonths.current.has(ym)) continue;
      loadedMonths.current.add(ym);
      monthRows.current.set(ym, list.length);
    }
    const ready = [...got].filter(([ym]) => loadedMonths.current.has(ym));
    for (const ym of todo) loadingMonths.current.delete(ym);
    if (ready.length) setMonths((prev) => ({ ...prev, ...Object.fromEntries(ready) }));
    // 읽지 못한 달은 실패로 표시하고, 이번에 읽은 달은 이전 실패 표시를 지웁니다.
    const failed = todo.filter((ym) => !got.has(ym));
    setFailedMonths((prev) => {
      if (!failed.length && !todo.some((ym) => prev[ym])) return prev;
      const next = { ...prev };
      for (const ym of todo) delete next[ym];
      for (const ym of failed) next[ym] = true;
      return next;
    });
    evictOldYears();
  }, [evictOldYears]);

  const ensureYear = useCallback((year: string) => ensureMonths(monthsOfYear(year)), [ensureMonths]);

  const ensureAuditYear = useCallback(async (year: string) => {
    if (loadedAuditYears.current.has(year)) return;
    loadedAuditYears.current.add(year);
    loadingAuditYears.current.add(year);
    const gen = generation.current;
    let list: AuditLog[];
    try {
      // 읽는 사이 이력이 저장됐다면(staleAuditYears) 빠졌을 수 있으므로 다시 읽습니다.
      do {
        staleAuditYears.current.delete(year);
        list = (await getItem<AuditLog[]>(auditKey(year))) ?? [];
      } while (staleAuditYears.current.has(year));
    } catch {
      loadedAuditYears.current.delete(year); // 읽기에 실패하면 다음에 다시 읽습니다(빈 목록으로 굳지 않게).
      return;
    } finally {
      loadingAuditYears.current.delete(year);
    }
    if (gen !== generation.current) return; // 읽는 동안 복원·초기화(reloadAll)가 일어났으면 버립니다.
    setAudits((prev) => (prev[year] ? prev : { ...prev, [year]: list }));
  }, []);

  const reloadAll = useCallback(async () => {
    generation.current++;
    loadedMonths.current.clear();
    monthRows.current.clear();
    loadingMonths.current.clear();
    staleMonths.current.clear();
    loadedAuditYears.current.clear();
    loadingAuditYears.current.clear();
    staleAuditYears.current.clear();
    lastUsed.current.clear();
    setMonths({});
    setEpoch((e) => e + 1);
    setAudits({});
    setHistory([]);
    setFailedMonths({});
    setYears(await listDonationYears());
  }, []);

  useEffect(() => {
    refreshYears();
    return subscribeExternalChanges(async (keys) => {
      const writes: Write[] = [];
      for (const k of keys) {
        const dm = DONATION_KEY_RE.exec(k)?.[1];
        const ay = AUDIT_KEY_RE.exec(k)?.[1];
        if (dm && (loadedMonths.current.has(dm) || loadingMonths.current.has(dm))) writes.push({ key: k, value: await readMonth(dm) });
        else if (ay && loadedAuditYears.current.has(ay)) writes.push({ key: k, value: await getItem(k) });
      }
      applyWrites(writes);
      bumpVersions(keys.flatMap((k) => DONATION_KEY_RE.exec(k)?.[1] ?? []).filter((ym) => !writes.some((w) => w.key === `donations_${ym}`)));
      if (keys.some((k) => DONATION_KEY_RE.test(k))) refreshYears();
    });
  }, [applyWrites, bumpVersions, refreshYears]);

  // 색인으로 찾으므로 월 전체를 읽지 않습니다. 무명 헌금은 중복이 없습니다.
  const findDuplicates = useCallback(async (drafts: DonationDraft[]) => Promise.all(drafts.map((d) => findDuplicateRow(d))), []);

  const saveBatch = useCallback(
    async (input: DonationDraft[], resolution: DuplicateResolution, label?: string) => {
      assertNotRestoring();
      let drafts = input;
      if (drafts.length === 0) throw new Error('저장할 금액이 없습니다.');
      const date = drafts[0].date;
      const year = yearOf(date);
      const ym = monthOfDate(date);
      const { writes, result } = await transact(async () => {
        // 무명 자동 번호는 저장소의 그날 내역으로 확정합니다(화면은 메모리 기준이라 달을 읽기 전이면 겹칠 수 있음). 한 묶음 = 한 사람이라 이름은 모두 같습니다.
        if (input[0].memberId === null) {
          const name = uniqueAnonymousName(await readDay(date), date, input[0].donorDisplayName);
          drafts = name === input[0].donorDisplayName ? input : input.map((d) => ({ ...d, donorDisplayName: name }));
        }
        const logs: AuditLog[] = [];
        const now = nowIso();
        const batch: SaveBatch = {
          batchId: newId(),
          savedAt: now,
          date,
          donorDisplayName: label ?? drafts[0].donorDisplayName,
          createdIds: [],
          createdAfter: [],
          mergedBefore: [],
          mergedAfter: [],
          lines: [],
        };
        // 이번 묶음에서 이미 만들거나 합친 내역(같은 성도·종류가 한 묶음에 또 나오면 그 내역에 합침)
        const touched = new Map<string, Donation>();
        const mine = new Map<string, Donation>();
        for (const d of drafts) {
          const k = d.memberId === null ? null : `${d.memberId}\u0000${d.offeringTypeId}`;
          const dup = resolution === 'MERGE' && k !== null ? (mine.get(k) ?? (await findDuplicateRow(d))) : undefined;
          if (dup) {
            const merged = mergeDonation(dup, d);
            touched.set(merged.id, merged);
            mine.set(k!, merged);
            if (!batch.mergedBefore.some((b) => b.id === dup.id)) batch.mergedBefore.push(dup);
            logs.push(makeAudit('UPDATE', dup, merged, REASON_MERGE, now));
            batch.lines.push({ offeringTypeId: d.offeringTypeId, amount: d.amount, merged: true });
          } else {
            const created = buildDonation(d, newId(), now);
            touched.set(created.id, created);
            if (k !== null) mine.set(k, created);
            batch.createdIds.push(created.id);
            batch.lines.push({ offeringTypeId: d.offeringTypeId, amount: d.amount, merged: false });
          }
        }
        batch.mergedAfter = batch.mergedBefore.map((b) => touched.get(b.id)!);
        batch.createdAfter = batch.createdIds.map((id) => touched.get(id)!);
        const w: Write[] = [rowWrite(ym, { puts: [...touched.values()], deletes: [] })];
        if (logs.length) w.push(auditAppend(year, logs));
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
      assertNotRestoring();
      const oldYm = monthOfDate(original.date);
      const newYm = monthOfDate(next.date);
      const newYear = yearOf(next.date);
      const { writes } = await transact(async () => {
        const before = await readRow(original.date, original.id);
        if (!before) throw new Error('수정할 내역을 찾을 수 없습니다. 다른 창에서 변경되었을 수 있습니다.');
        const after: Donation = { ...next, id: before.id, createdAt: before.createdAt };
        // 무명 내역을 다른 날로 옮기면 그날 이미 있는 같은 번호와 겹칠 수 있으므로, 옮긴 날의 내역으로 번호를 다시 정합니다.
        if (after.memberId === null && after.date !== before.date) after.donorDisplayName = uniqueAnonymousName(await readDay(after.date), after.date, after.donorDisplayName);
        // 날짜나 종류를 바꿔 같은 날짜·성도·종류의 다른 내역과 겹치게 되면 막습니다(입력 때는 합산하므로 같은 규칙). 금액·메모만 고칠 때는 검사하지 않습니다.
        if (after.date !== before.date || after.offeringTypeId !== before.offeringTypeId) {
          const dup = await findDuplicateRow(after);
          if (dup && dup.id !== before.id) throw new Error('같은 날짜·종류의 내역이 이미 있습니다. 그 내역을 수정하거나 삭제한 뒤 다시 시도하세요.');
        }
        const w: Write[] = [];
        // 날짜가 바뀌면 이전 행을 지우고 새 날짜의 행을 만듭니다(달(연도) 경계를 넘으면 두 달의 행이 바뀝니다).
        const moved = before.date !== after.date;
        if (oldYm === newYm) w.push(rowWrite(oldYm, { puts: [after], deletes: moved ? [[before.date, before.id]] : [] }));
        else w.push(rowWrite(oldYm, { puts: [], deletes: [[before.date, before.id]] }), rowWrite(newYm, { puts: [after], deletes: [] }));
        w.push(auditAppend(newYear, [makeAudit('UPDATE', before, after, reason)]));
        return { writes: w, result: undefined };
      });
      applyWrites(writes);
    },
    [applyWrites],
  );

  const deleteDonation = useCallback(
    async (target: Donation, reason: string) => {
      assertNotRestoring();
      const year = yearOf(target.date);
      const ym = monthOfDate(target.date);
      const { writes } = await transact(async () => {
        const before = await readRow(target.date, target.id);
        if (!before) throw new Error('삭제할 내역을 찾을 수 없습니다. 다른 창에서 변경되었을 수 있습니다.');
        return { writes: [rowWrite(ym, { puts: [], deletes: [[before.date, before.id]] }), auditAppend(year, [makeAudit('DELETE', before, null, reason)])], result: undefined };
      });
      applyWrites(writes);
    },
    [applyWrites],
  );

  const undoLast = useCallback(async () => {
    assertNotRestoring();
    const batch = historyRef.current[0];
    if (!batch) return null;
    const { writes } = await transact(async () => {
      const now = nowIso();
      const ops = new Map<string, RowOps>();
      const opsOf = (date: string): RowOps => {
        const ym = monthOfDate(date);
        if (!ops.has(ym)) ops.set(ym, { puts: [], deletes: [] });
        return ops.get(ym)!;
      };
      const logs = new Map<string, AuditLog[]>();
      const auditOf = (date: string): AuditLog[] => {
        const y = yearOf(date);
        if (!logs.has(y)) logs.set(y, []);
        return logs.get(y)!;
      };
      // 저장한 날짜에서 먼저 찾고, 저장 후 [수정]으로 날짜가 바뀌었다면 id로 찾습니다(드문 경우라 전체를 훑음).
      const locate = async (id: string, date: string): Promise<Donation | null> => (await readRow(date, id)) ?? (await findDonationById(id));
      // 저장 뒤에 [수정]한 내역을 복구하면 그 수정이 조용히 사라지므로 막습니다(새 내역·합산 내역 모두).
      const assertUnchanged = (current: Donation, after: Donation | undefined) => {
        if (after && (current.amount !== after.amount || current.date !== after.date || current.offeringTypeId !== after.offeringTypeId || current.memo !== after.memo)) {
          throw new Error('저장한 뒤 수정된 내역이 있어 복구할 수 없습니다. 내역 화면에서 직접 수정하거나 삭제하세요.');
        }
      };
      for (const [i, id] of batch.createdIds.entries()) {
        const removed = await locate(id, batch.date);
        if (!removed) continue; // 이미 다른 경로로 삭제됨
        assertUnchanged(removed, batch.createdAfter[i]);
        opsOf(removed.date).deletes.push([removed.date, removed.id]);
        auditOf(removed.date).push(makeAudit('DELETE', removed, null, REASON_UNDO, now));
      }
      for (const [i, before] of batch.mergedBefore.entries()) {
        const current = await locate(before.id, before.date);
        if (!current) continue;
        assertUnchanged(current, batch.mergedAfter[i]);
        auditOf(current.date).push(makeAudit('UPDATE', current, before, REASON_UNDO, now));
        opsOf(before.date).puts.push(before);
      }
      const w: Write[] = [];
      for (const [m, o] of ops) w.push(rowWrite(m, o));
      for (const [y, l] of logs) w.push(auditAppend(y, l));
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
  const value = useMemo(() => ({ months, epoch, monthVersions, audits, years, history, failedMonths, actions }), [months, epoch, monthVersions, audits, years, history, failedMonths, actions]);
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
  const key = yms.join(',');
  useEffect(() => {
    const list = key ? key.split(',') : [];
    const unpin = actions.pinMonths(list); // 이 화면이 쓰는 동안은 해당 연도를 메모리에서 내리지 않음
    void actions.ensureMonths(list);
    return unpin;
  }, [actions, key, epoch]);
  // 셀렉터가 요청한 달 배열이 그대로면 이전 결과를 돌려주므로, 다른 달이 바뀌어도 이 컴포넌트는 다시 렌더되지 않습니다.
  const memo = useRef<{ parts: Donation[][]; value: Donation[] } | null>(null);
  return useDonationSelector((s) => {
    const parts = yms.map((m) => s.months[m] ?? EMPTY);
    const prev = memo.current;
    if (prev && prev.parts.length === parts.length && parts.every((p, i) => p === prev.parts[i])) return prev.value;
    memo.current = { parts, value: parts.length === 1 ? parts[0] : parts.flat() };
    return memo.current.value;
  });
}
/** 지정한 달 중 하나라도 읽기에 실패했는지(다시 읽으려면 actions.ensureMonths) */
export const useMonthsLoadFailed = (yms: readonly string[]): boolean => useDonationSelector((s) => yms.some((ym) => s.failedMonths[ym]));
export const useAllAudits =(): Record<string, AuditLog[]> => useDonationSelector((s) => s.audits);
export const useDonationYears = () => useDonationSelector((s) => s.years);
export const useMonthVersions = () => useDonationSelector((s) => s.monthVersions);
export const useDonationEpoch = () => useDonationSelector((s) => s.epoch);
export const useDonationMonthsRecord = () => useDonationSelector((s) => s.months);
export const useSaveHistory = () => useDonationSelector((s) => s.history);
