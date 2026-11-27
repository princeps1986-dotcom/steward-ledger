import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAllAudits, useDonationActions, useDonationEpoch, useDonationMonths, useDonationYears, useMonthsLoadFailed, useMonthVersions } from '../contexts/DonationContext';
import { useMemberById, useMembers } from '../contexts/MemberContext';
import { useMemberOrderKey, useNameTag } from './useNameTag';
import { useOfferingTypeById, useOfferingTypes } from '../contexts/OfferingTypeContext';
import type { AuditLog, Donation } from '../contexts/types';
import { formatWon } from '../services/domain/amount';
import { auditLogsForPeriod } from '../services/domain/auditFilter';
import { ListPager } from '../services/domain/listPager';
import { AUDIT_KEY_RE, listAuditKeys, readMemberDonations, readMonth } from '../services/storage/storageService';
import { sumMonth, type MonthSums } from '../services/domain/periodSummary';
import { monthRangeOf, shiftDay, shiftWeek, weekRangeOf } from '../services/domain/calendar';
import { formatDateTime, isValidDateString, lastSunday, monthOf, seoulNow, monthsOfPeriod, periodLabel, withWeekday, type PeriodType } from '../services/domain/dates';
import { buildWeeklyMatrix, withoutInactiveMembers } from '../services/domain/weekly';
import { familyKeyOf, familyKeyOfMember, type FamilyBasis } from '../services/domain/family';
import { currentHeadOf } from '../services/domain/memberRules';
import { memberLabel } from '../services/domain/search';
import { desktop, type SavedFileInfo } from '../services/desktopBridge';
import { compareFixed, compareKo } from '../services/domain/compare';
import type { PickerOption } from '../components/shared/MemberPicker';

export type ReportTab = 'SUMMARY' | 'LIST' | 'PERSONAL' | 'AUDIT';

/** 선택이 바뀐 뒤 이 시간(ms) 동안 더 바뀌지 않아야 보고서를 새로 계산합니다. */
export const REPORT_DELAY_MS = 250;

/** 값이 바뀐 뒤 delay 동안 더 바뀌지 않으면 그 값을 돌려줍니다(그동안은 이전 값). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (v === value) return;
    const id = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(id);
  }, [value, v, delay]);
  return v;
}

/** 보고서 공통 필터: 연도 + 기간(연/분기/월/주) + 합산 기준 */
const NO_MONTHS: string[] = [];

/** 달별 변경 횟수와 epoch로 만든 달의 버전 문자열(달이 바뀌었는지 비교용) */
function useMonthVersionKey(yms: readonly string[]): string {
  const versions = useMonthVersions();
  const epoch = useDonationEpoch();
  return yms.map((ym) => `${versions[ym] ?? 0}:${epoch}`).join(',');
}

/**
 * 달마다 헌금 종류별 합계만 구합니다(분기·연도 요약용). 내역은 한 달씩 읽어 합계로 줄인 뒤 버리므로 메모리에 쌓이지 않고,
 * 구한 합계는 달의 버전과 함께 기억해 두어 연도를 바꿨다 돌아오거나 저장한 뒤에도 바뀐 달만 다시 읽습니다.
 * yms 전체를 다 구한 뒤에 한 번에 바뀌며, 다른 달 목록을 구하는 동안은 sums가 null(loading)입니다.
 */
function useMonthSums(yms: readonly string[]): { sums: ReadonlyMap<string, MonthSums> | null; loading: boolean; failed: boolean } {
  const key = yms.join(',');
  const versionKey = useMonthVersionKey(yms);
  const cache = useRef(new Map<string, { version: string; sums: MonthSums }>());
  const [result, setResult] = useState<{ key: string; sums: ReadonlyMap<string, MonthSums> } | null>(null);
  const [failedKey, setFailedKey] = useState('');
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const list = key.split(',');
    const vs = versionKey.split(',');
    void (async () => {
      const out = new Map<string, MonthSums>();
      for (const [i, ym] of list.entries()) {
        const hit = cache.current.get(ym);
        if (hit?.version === vs[i]) {
          out.set(ym, hit.sums);
          continue;
        }
        const sums = sumMonth(await readMonth(ym));
        if (stop) return;
        cache.current.set(ym, { version: vs[i], sums });
        out.set(ym, sums);
      }
      if (!stop) setResult({ key, sums: out });
    })().catch(() => {
      if (!stop) setFailedKey(`${key}#${versionKey}`); // 읽기 실패: '불러오는 중'을 끝내고 알립니다(기간·데이터가 바뀌면 다시 시도).
    });
    return () => {
      stop = true;
    };
  }, [key, versionKey]);
  const ready = !!key && result?.key === key;
  const failed = !!key && !ready && failedKey === `${key}#${versionKey}`;
  return { sums: ready ? result!.sums : null, loading: !!key && !ready && !failed, failed };
}

/** loadData가 false이면 이 화면은 보고서 기간의 헌금을 메모리에 올리지 않습니다(전체 입력 내역 탭은 달 단위로 직접 읽음). */
export function useReportFilters(loadData = true) {
  const years = useDonationYears();
  const currentYear = String(seoulNow().getFullYear());
  const [selYear, setYear] = useState(currentYear);
  // 보고서 화면에 들어오면 가장 최근의 지난 주일(오늘이 주일이면 오늘)이 속한 주(일~토)의 주별 보고서를 기본으로 보여 줍니다.
  const [selPeriodType, setPeriodTypeState] = useState<PeriodType>('WEEK');
  const [selPeriodValue, setPeriodValue] = useState(1);
  const [basis, setBasis] = useState<FamilyBasis>('CURRENT');

  // 주별: 가장 최근의 지난 주일이 기본 선택. 마지막 유효 날짜를 기준으로 집계합니다.
  const [weekText, setWeekText] = useState(() => lastSunday());
  const [selWeekBase, setWeekBase] = useState(weekText);

  // 선택 칸(연도·기간·주)은 바로 바뀌지만, 보고서 계산·표시는 선택이 잠시(REPORT_DELAY_MS) 멈춘 뒤에 합니다.
  // 주 이동 등을 연타할 때 중간 보고서를 매번 계산하지 않기 위함입니다.
  // 주별은 같은 주(일~토) 안에서 날짜만 바꿔도 보고서가 같으므로, 기준 날짜를 그 주의 시작일로 맞춰 다시 계산하지 않게 합니다.
  const weekKey = selPeriodType === 'WEEK' ? weekRangeOf(selWeekBase).start : selWeekBase;
  const selection = useMemo(
    () => ({ year: selYear, periodType: selPeriodType, periodValue: selPeriodValue, weekBase: weekKey }),
    [selYear, selPeriodType, selPeriodValue, weekKey],
  );
  const applied = useDebouncedValue(selection, REPORT_DELAY_MS);
  const pending = applied !== selection;
  const { year, periodType, periodValue, weekBase } = applied;
  const isWeek = periodType === 'WEEK';
  const isDay = periodType === 'DAY';
  const isRange = isWeek || isDay; // 날짜 범위(주·하루)로 거르는 보고서
  // 주별은 그 날짜가 속한 주(일~토), 일별은 그 하루(시작=종료). 이 범위가 주별·일별 보고서의 집계 기간입니다.
  const week = useMemo(() => (isDay ? { start: weekBase, end: weekBase } : weekRangeOf(weekBase)), [isDay, weekBase]);
  const monthRange = useMemo(() => monthRangeOf(year, periodValue), [year, periodValue]);

  const months = useMemo(() => monthsOfPeriod(periodType, periodValue), [periodType, periodValue]);
  // 이 보고서가 쓰는 달('YYYY-MM')만 메모리로 불러옵니다: 주별은 시작·종료일이 속한 달(1~2개), 월·분기·연도는 그 기간의 달들.
  const neededMonths = useMemo(
    () => (isRange ? [...new Set([week.start.slice(0, 7), week.end.slice(0, 7)])] : months.map((m) => `${year}-${String(m).padStart(2, '0')}`)),
    [isRange, week, months, year],
  );
  // 분기·연도 요약은 내역을 메모리에 올리지 않고 달마다 합계만 구합니다(연 수십만 건에서도 메모리가 작음).
  // 개인별 탭은 색인으로 직접 읽으므로 이 기간의 내역이 필요 없습니다.
  // 합계는 전체 입력 내역 탭(loadData=false)에서도 구해 그 탭의 건수·합계를 바로 보여 줍니다(내역은 메모리에 올리지 않음).
  const summaryMode = !isRange && periodType !== 'MONTH';
  const sourceMonths = loadData && !summaryMode ? neededMonths : NO_MONTHS;
  const source = useDonationMonths(sourceMonths);
  const sourceFailed = useMonthsLoadFailed(sourceMonths);
  const monthSums = useMonthSums(summaryMode ? neededMonths : NO_MONTHS);
  const listMonths = useMemo(() => [...neededMonths].sort().reverse(), [neededMonths]); // 전체 입력 내역 탭이 직접 읽는 달(최신 달부터)

  // 헌금을 모두 지운 해도 수정·삭제 이력은 남으므로, 이력이 있는 연도도 고를 수 있게 합니다(헌금 연도 목록이 바뀌면 다시 확인).
  const [auditYears, setAuditYears] = useState<string[]>([]);
  useEffect(() => {
    let stop = false;
    void listAuditKeys()
      .then((keys) => !stop && setAuditYears(keys.map((k) => AUDIT_KEY_RE.exec(k)![1])))
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [years]);
  const yearOptions = useMemo(() => [...new Set([...years, ...auditYears, currentYear])].sort().reverse(), [years, auditYears, currentYear]);
  // 월·분기·연도는 불러온 달이 곧 그 기간이므로 그대로 쓰고(다른 달에 저장해도 배열이 바뀌지 않음), 주별만 날짜로 거릅니다.
  const donations = useMemo(() => (isRange ? source.filter((d) => d.date >= week.start && d.date <= week.end) : source), [isRange, week, source]);

  // 이전/다음 주를 빠르게 연타해도 매번 직전 선택에서 이어 가도록 최신 선택 주를 ref에도 즉시 기록합니다.
  const latestWeek = useRef(selWeekBase);
  const moveWeek = useCallback((d: string) => {
    latestWeek.current = d;
    setWeekText(d);
    setWeekBase(d);
  }, []);
  const setWeekDate = useCallback((v: string) => {
    setWeekText(v);
    if (isValidDateString(v)) {
      latestWeek.current = v;
      setWeekBase(v);
    }
  }, []);

  const setPeriodType = useCallback(
    (t: PeriodType) => {
      setPeriodTypeState(t);
      setPeriodValue(t === 'MONTH' ? seoulNow().getMonth() + 1 : t === 'QUARTER' ? Math.floor(seoulNow().getMonth() / 3) + 1 : 1);
      if (t === 'WEEK' || t === 'DAY') moveWeek(lastSunday()); // 주별·일별을 선택할 때마다 가장 최근의 지난 주일을 기본 선택
    },
    [moveWeek],
  );

  const periodValueOptions =
    selPeriodType === 'MONTH'
      ? Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}월` }))
      : selPeriodType === 'QUARTER'
        ? [1, 2, 3, 4].map((q) => ({ value: q, label: `${q}분기` }))
        : [];

  return {
    // 보고서에 실제 적용된 값(계산·인쇄·PDF 기준)
    year,
    periodType,
    periodValue,
    // 선택 칸에 보이는 값과 변경 함수(적용은 잠시 뒤). pending이면 아직 이전 선택의 보고서가 보이는 중입니다.
    sel: { year: selYear, periodType: selPeriodType, periodValue: selPeriodValue, isWeek: selPeriodType === 'WEEK', isDay: selPeriodType === 'DAY', isRange: selPeriodType === 'WEEK' || selPeriodType === 'DAY' },
    pending: pending || monthSums.loading,
    /** 기간의 내역이나 분기·연도 합계를 읽지 못함(보고서 숫자를 믿을 수 없음) */
    loadFailed: monthSums.failed || sourceFailed,
    setYear,
    yearOptions,
    setPeriodType,
    setPeriodValue,
    periodValueOptions,
    months,
    donations,
    /** 분기·연도: 달('YYYY-MM')별 헌금 종류 합계(다 구하기 전에는 null). 그 외 기간은 null이고 donations를 씁니다. */
    monthSums: monthSums.sums,
    listMonths,
    listRange: isRange ? week : null,
    basis,
    setBasis,
    // 성도명 × 헌금 종류 표로 보여 주는 보고서(주별·월별)의 집계 기간. 연·분기는 null
    personKind: (isDay ? 'DAY' : isWeek ? 'WEEK' : periodType === 'MONTH' ? 'MONTH' : null) as 'WEEK' | 'MONTH' | 'DAY' | null,
    personRange: isRange ? week : periodType === 'MONTH' ? monthRange : null,
    // 주별 전용
    isWeek,
    isDay,
    isRange,
    week,
    weekDate: weekText,
    setWeekDate,
    prevWeek: () => moveWeek(shiftWeek(latestWeek.current, -1)),
    nextWeek: () => moveWeek(shiftWeek(latestWeek.current, 1)),
    prevDay: () => moveWeek(shiftDay(latestWeek.current, -1)),
    nextDay: () => moveWeek(shiftDay(latestWeek.current, 1)),
    goLastSunday: () => moveWeek(lastSunday()),
    label: isDay ? `${withWeekday(week.start)} 일별` : isWeek ? `${withWeekday(week.start)} ~ ${withWeekday(week.end)} 주별` : periodLabel(year, periodType, periodValue),
  };
}

export type ReportFilters = ReturnType<typeof useReportFilters>;

const NO_HIDDEN: ReadonlySet<string> = new Set();

/** 보고서에서 숨기기로 한 헌금 종류의 내역을 뺍니다(화면·인쇄·PDF 저장 공통). */
function withoutTypes<T extends { offeringTypeId: string }>(donations: readonly T[], hidden: ReadonlySet<string>): readonly T[] {
  return hidden.size === 0 ? donations : donations.filter((d) => !hidden.has(d.offeringTypeId));
}

const typesWithout = <T extends { id: string }>(types: readonly T[], hidden: ReadonlySet<string>): readonly T[] =>
  hidden.size === 0 ? types : types.filter((t) => !hidden.has(t.id));

/** 종합 보고서의 [헌금 종류 표시] 선택지: 이 보고서 기간에 쓰였거나 활성인 종류(정렬 순서대로) */
export function useTypeToggleOptions(f: ReportFilters): { id: string; name: string; isActive: boolean }[] {
  const types = useOfferingTypes();
  return useMemo(() => {
    // f.donations는 주별이면 이미 그 주로 걸러져 있고, 분기·연도는 달별 합계에서 씁니다.
    const used = new Set(f.monthSums ? [...f.monthSums.values()].flatMap((m) => [...m.keys()]) : f.donations.map((d) => d.offeringTypeId));
    return types
      .filter((t) => t.isActive || used.has(t.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ id: t.id, name: t.name, isActive: t.isActive }));
  }, [types, f.donations, f.monthSums]);
}

/** 종합 보고서(분기·연도): 헌금 종류 × 월 매트릭스. 달별 합계(f.monthSums)에서 숨긴 종류를 빼고 더합니다. */
export function useSummaryReport(f: ReportFilters, hidden: ReadonlySet<string> = NO_HIDDEN) {
  const types = useOfferingTypes();
  return useMemo(() => {
    const used = new Set<string>();
    const cell = new Map<string, number>();
    const byType = new Map<string, number>();
    const byMonth = new Map<number, number>();
    let total = 0;
    let anonymousTotal = 0;
    let count = 0;
    for (const [ym, sums] of f.monthSums ?? []) {
      const m = monthOf(`${ym}-01`);
      for (const [t, s] of sums) {
        if (hidden.has(t)) continue;
        used.add(t);
        cell.set(`${t}|${m}`, (cell.get(`${t}|${m}`) ?? 0) + s.amount);
        byType.set(t, (byType.get(t) ?? 0) + s.amount);
        byMonth.set(m, (byMonth.get(m) ?? 0) + s.amount);
        total += s.amount;
        anonymousTotal += s.anonymous;
        count += s.count;
      }
    }
    const list: { id: string; name: string }[] = types.filter((t) => !hidden.has(t.id) && (t.isActive || used.has(t.id))).sort((a, b) => a.sortOrder - b.sortOrder);
    // 장부에만 있는 알 수 없는 종류도 줄로 보여 줘야 줄 합계가 총합과 맞습니다(주별 표와 같은 방식).
    const known = new Set(types.map((t) => t.id));
    for (const id of used) if (!known.has(id)) list.push({ id, name: '(삭제된 종류)' });
    return {
      months: f.months,
      rows: list.map((t) => ({
        id: t.id,
        name: t.name,
        cells: f.months.map((m) => cell.get(`${t.id}|${m}`) ?? 0),
        total: byType.get(t.id) ?? 0,
      })),
      monthTotals: f.months.map((m) => byMonth.get(m) ?? 0),
      total,
      count,
      anonymousTotal,
    };
  }, [types, f.monthSums, f.months, hidden]);
}

/** 비활성 성도의 내역을 뺍니다(무명/방문자는 성도가 없으므로 항상 남김). includeInactive면 그대로 돌려줍니다. */
function useDonationsForSummary(donations: readonly Donation[], includeInactive: boolean): readonly Donation[] {
  const members = useMembers();
  return useMemo(() => (includeInactive ? donations : withoutInactiveMembers(donations, members)), [donations, members, includeInactive]);
}

/** 주별 보고서(종합 보고서의 기간 '주별'): 선택 주(일~토)를 헌금 종류 × 성도명 교차표로 집계 */
export function useWeeklyMatrix(f: ReportFilters, hidden: ReadonlySet<string> = NO_HIDDEN, includeInactive = true) {
  const types = useOfferingTypes();
  const orderKey = useMemberOrderKey();
  const range = f.personRange!;
  const donations = useDonationsForSummary(f.donations, includeInactive);
  return useMemo(() => {
    const matrix = buildWeeklyMatrix(withoutTypes(donations, hidden), typesWithout(types, hidden), range, orderKey);
    // 주별은 "시작 ~ 종료", 월별은 "YYYY-MM"으로 표시
    const rangeLabel = f.personKind === 'MONTH' ? range.start.slice(0, 7) : f.personKind === 'DAY' ? withWeekday(range.start) : `${withWeekday(range.start)} ~ ${withWeekday(range.end)}`;
    return { matrix, rangeLabel, hasData: matrix.count > 0 };
  }, [donations, types, range, orderKey, hidden, f.personKind]);
}

/** 종합 보고서에 노출할 내역(숨김 종류 제외)이 하나라도 있는지. 인쇄·PDF 저장 버튼의 활성 조건으로 씁니다. */
export function useHasExportableData(f: ReportFilters, hidden: ReadonlySet<string> = NO_HIDDEN, includeInactive = true): boolean {
  const types = useOfferingTypes();
  const orderKey = useMemberOrderKey();
  const donations = useDonationsForSummary(f.donations, includeInactive);
  return useMemo(() => {
    if (f.personRange) return buildWeeklyMatrix(withoutTypes(donations, hidden), typesWithout(types, hidden), f.personRange, orderKey).count > 0;
    for (const sums of f.monthSums?.values() ?? []) for (const [t, s] of sums) if (!hidden.has(t) && s.count > 0) return true;
    return false;
  }, [donations, f.monthSums, f.personRange, types, orderKey, hidden]);
}

/** 입력 시각(한국 시간). 복원 검사가 createdAt은 확인하지 않아, 없거나 읽을 수 없는 값은 빈 칸으로 둡니다. */
function enteredAtOf(createdAt: string): string {
  try {
    return formatDateTime(createdAt);
  } catch {
    return '';
  }
}

/**
 * 전체 입력 내역 탭: 현재 보고서 기간의 모든 헌금 내역(무명/방문자 포함)을 최신순으로, 이름으로 거를 수 있음.
 * 기간 전체를 메모리에 올리지 않고 달 단위로 읽습니다(ListPager): 달마다 건수·합계만 구해 두고, 화면에 보이는 행의 달만 읽습니다.
 */
export function useDonationListReport(f: ReportFilters) {
  const typeById = useOfferingTypeById();
  const tagOf = useNameTag(true);
  const versions = useMonthVersions();
  const epoch = useDonationEpoch();
  const [query, setQuery] = useState('');
  const [, setTick] = useState(0);
  const [done, setDone] = useState(false);
  // 기간의 어느 달을 읽지 못하면 건수·합계에서 그 달이 빠지므로, 화면이 알릴 수 있게 표시합니다.
  const [failed, setFailed] = useState(false);
  // 입력 칸은 바로 반영하고, 달들을 다시 거르는 계산은 입력이 잠시 멈춘 뒤에 합니다.
  const appliedQuery = useDebouncedValue(query, 350);
  const pager = useMemo(() => new ListPager(readMonth, undefined, () => setTick((t) => t + 1)), []);
  const { listMonths, listRange } = f;
  const versionKey = listMonths.map((ym) => `${versions[ym] ?? 0}:${epoch}`).join(',');
  const rangeStart = listRange?.start ?? '';
  const rangeEnd = listRange?.end ?? '';
  useEffect(() => {
    let stop = false;
    setDone(false);
    setFailed(false);
    const range = rangeStart ? { start: rangeStart, end: rangeEnd } : null;
    const keys = versionKey.split(',');
    void pager
      .refresh(listMonths, (ym) => keys[listMonths.indexOf(ym)], { query: appliedQuery, range }, () => stop)
      .catch(() => {
        if (!stop) setFailed(true); // 읽기 실패: 읽은 달까지만 보이므로 알립니다(데이터·조건이 바뀌면 다시 시도).
      })
      .then(() => !stop && setDone(true));
    return () => {
      stop = true;
    };
  }, [pager, listMonths, versionKey, appliedQuery, rangeStart, rangeEnd]);
  const rowAt = (i: number) => {
    const d = pager.rowAt(listMonths, i);
    return {
      donation: d,
      typeName: d ? typeById.get(d.offeringTypeId)?.name ?? '(삭제된 종류)' : '',
      amountLabel: d ? formatWon(d.amount) : '',
      enteredAt: d ? enteredAtOf(d.createdAt) : '',
      tag: d ? tagOf(d.memberId) : null,
    };
  };
  // 분기·연도에서 검색어가 없으면 종합 보고서가 구한 달별 합계로 건수·합계를 바로 보여 줍니다(달을 읽는 동안 숫자가 올라가지 않게).
  const sums = appliedQuery.replace(/\s/g, '') === '' ? f.monthSums : null;
  if (sums) {
    let count = 0;
    let total = 0;
    for (const m of sums.values()) {
      for (const s of m.values()) {
        count += s.count;
        total += s.amount;
      }
    }
    return { query, setQuery, count, total, rowAt, loading: false, failed };
  }
  return { query, setQuery, count: pager.count, total: pager.total, rowAt, loading: !done, failed };
}

/** 개인별·대표자별 조회 */
export function usePersonalReport(f: ReportFilters) {
  const members = useMembers();
  const memberById = useMemberById();
  const typeById = useOfferingTypeById();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickedMode, setPickedMode] = useState<'PERSON' | 'FAMILY'>('PERSON');
  // 대표자 합산으로 들어갈 때마다 집계 기준은 현재 묶음으로 시작합니다(납부 당시 기준이 남아 있지 않도록).
  const setMode = (m: 'PERSON' | 'FAMILY') => {
    setPickedMode(m);
    if (m === 'FAMILY') f.setBasis('CURRENT');
  };
  // 대표자 합산은 연도별 보고서에서만 가능합니다. 다른 기간에서는 선택과 무관하게 개인 기준입니다.
  const mode = f.periodType === 'YEAR' ? pickedMode : 'PERSON';
  const selected = selectedId ? memberById.get(selectedId) ?? null : null;

  // 비활성 성도도 과거 내역 조회를 위해 선택 대상에 포함(검색은 선택 칸이 함)
  const options = useMemo(() => [...members].sort((a, b) => compareKo(a.name, b.name)).map((m): PickerOption => ({ id: m.id, label: memberLabel(m), member: m })), [members]);

  // 보고서 기간의 내역을 메모리에 올리지 않고 직접 읽습니다. 개인·현재 묶음은 memberId 색인으로 그 성도들의 내역만 읽고,
  // 납부 당시 묶음은 색인이 없어 기간의 달을 하나씩 읽으며 거릅니다(메모리에는 한 달치만).
  const { listMonths, listRange, basis } = f;
  const versionKey = useMonthVersionKey(listMonths);
  const memberIds = useMemo(() => {
    if (!selected) return null;
    if (mode === 'PERSON') return [selected.id];
    if (basis === 'SNAPSHOT') return null;
    const key = familyKeyOfMember(selected);
    return members.filter((m) => familyKeyOfMember(m) === key).map((m) => m.id);
  }, [selected, mode, basis, members]);
  // 선택·기간·대상 성도가 같으면 같은 조회입니다(이 값과 versionKey가 바뀔 때만 다시 읽음).
  const queryKey = selected ? [selected.id, mode, basis, listMonths.join(','), listRange?.start ?? '', listRange?.end ?? '', memberIds?.join(',') ?? ''].join('|') : '';
  const [found, setFound] = useState<{ key: string; memberId: string; list: Donation[] } | null>(null);
  const [failedKey, setFailedKey] = useState('');
  const latest = useRef({ selected, memberIds, listMonths, listRange, memberById });
  latest.current = { selected, memberIds, listMonths, listRange, memberById };
  useEffect(() => {
    const { selected: who, memberIds: ids, listMonths: yms, listRange: range, memberById: byId } = latest.current;
    if (!who) return;
    let stop = false;
    const months = new Set(yms);
    const inPeriod = (d: Donation) => months.has(d.date.slice(0, 7)) && (!range || (d.date >= range.start && d.date <= range.end));
    const load = async (): Promise<Donation[]> => {
      if (ids) return (await readMemberDonations(ids)).filter(inPeriod);
      const key = familyKeyOfMember(who);
      const out: Donation[] = [];
      for (const ym of yms) {
        if (stop) break;
        for (const d of await readMonth(ym)) if (inPeriod(d) && familyKeyOf(d, 'SNAPSHOT', byId) === key) out.push(d);
      }
      return out;
    };
    void load()
      .then((list) => {
        if (!stop) setFound({ key: queryKey, memberId: who.id, list: list.sort((a, b) => compareFixed(a.date, b.date) || compareFixed(a.createdAt, b.createdAt)) });
      })
      .catch(() => {
        if (!stop) setFailedKey(`${queryKey}#${versionKey}`); // 읽기 실패: '불러오는 중'을 끝내고 알립니다(선택·데이터가 바뀌면 다시 시도).
      });
    return () => {
      stop = true;
    };
  }, [queryKey, versionKey]);
  const failed = !!selected && found?.key !== queryKey && failedKey === `${queryKey}#${versionKey}`;
  const loading = !!selected && found?.key !== queryKey && !failed;
  // 새 결과를 기다리는 동안에도 같은 성도의 마지막 결과를 남깁니다(기준 전환 때 표가 비었다 채워지며 깜박이지 않게).
  // 성도가 바뀌거나 읽기가 실패하면 버립니다.
  const rows = useMemo(() => (found && selected && found.memberId === selected.id && !failed ? found.list : []), [found, selected, failed]);
  const stale = loading && rows.length > 0;
  // 0.3초 안에 끝나는 조회는 '불러오는 중' 문구를 띄우지 않습니다(깜빡임 방지).
  const slow = useDebouncedValue(loading, 300);

  const head = selected?.familyGroupId ? currentHeadOf(members, selected.familyGroupId) : undefined;
  const byType = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const d of rows) {
      const t = map.get(d.offeringTypeId) ?? { amount: 0, count: 0 };
      map.set(d.offeringTypeId, { amount: t.amount + d.amount, count: t.count + 1 });
    }
    return [...map.entries()]
      .map(([id, { amount, count }]) => ({ id, name: typeById.get(id)?.name ?? '(삭제된 종류)', amount, count, sort: typeById.get(id)?.sortOrder ?? 999 }))
      .sort((a, b) => a.sort - b.sort);
  }, [rows, typeById]);

  return {
    options,
    selectedId,
    select: (id: string) => {
      setSelectedId(id || null);
      // 선택을 풀면 조회 방식·합산 기준도 처음 상태(개인 기준·현재 묶음)로 복구합니다.
      if (!id) {
        setPickedMode('PERSON');
        f.setBasis('CURRENT');
      }
    },
    selectedLabel: selected ? memberLabel(selected) : '',
    /** 대표자 합산 조회에서 보여 줄 현재 대표자(묶음에 연결되지 않은 성도는 안내 문구) */
    headLabel: !selected ? '' : !selected.familyGroupId ? '묶음 없음(본인만)' : head ? memberLabel(head) : '(대표자 없음)',
    hasSelection: !!selected,
    loading,
    stale,
    slow,
    failed,
    mode,
    setMode,
    rows: rows.map((d) => ({
      donation: d,
      typeName: typeById.get(d.offeringTypeId)?.name ?? '(삭제된 종류)',
      amountLabel: formatWon(d.amount),
    })),
    byType,
    total: rows.reduce((s, d) => s + d.amount, 0),
  };
}

/** 이력 한 줄에 보여 줄 헌금 내역(성도명 구분 표기를 작게 붙이기 위해 부분별로 나눔). null = 삭제됨 */
export interface AuditDonationView {
  date: string;
  name: string;
  tag: string | null;
  typeName: string;
  amount: string;
  memo: string | null;
}

/**
 * 수정·삭제 이력 탭: 지금 보고 있는 보고서(연/분기/월/주)의 기간에 해당하는 내역의 이력만 보여 줍니다.
 * 이력의 변경 전·후 내역 중 하나라도 보고서 기간에 속하면 포함합니다(날짜를 다른 기간으로 옮긴 수정도 양쪽 보고서에서 보임).
 * 연도를 옮긴 수정은 새 연도의 이력 장부에 기록되므로 모든 연도의 이력을 불러와 날짜로 거릅니다.
 */
export function useAuditLogTab(f: ReportFilters) {
  const { ensureAuditYear } = useDonationActions();
  const years = useDonationYears();
  const audits = useAllAudits();
  const typeById = useOfferingTypeById();
  const tagOf = useNameTag(true);
  useEffect(() => {
    for (const y of years) void ensureAuditYear(y);
    // 헌금을 모두 지운 해도 이력은 남으므로, 이력이 저장된 연도도 불러옵니다(헌금 연도 목록이 바뀌면 다시 확인).
    void listAuditKeys()
      .then((keys) => keys.forEach((k) => void ensureAuditYear(AUDIT_KEY_RE.exec(k)![1])))
      .catch(() => undefined);
  }, [ensureAuditYear, years]);

  const { isRange, week, year, months } = f;
  return useMemo(() => {
    const describe = (d: Donation | null): AuditDonationView | null =>
      d
        ? {
            date: d.date,
            name: d.donorDisplayName,
            tag: tagOf(d.memberId),
            typeName: typeById.get(d.offeringTypeId)?.name ?? '(삭제된 종류)',
            amount: formatWon(d.amount),
            memo: d.memo ?? null,
          }
        : null;
    return auditLogsForPeriod(Object.values(audits).flat(), { isWeek: isRange, week, year, months }).map((l: AuditLog) => ({
      id: l.id,
      time: formatDateTime(l.timestamp),
      actionLabel: l.action === 'UPDATE' ? '수정' : '삭제',
      reason: l.reason,
      actor: l.actor ?? '',
      before: describe(l.beforeSnapshot),
      after: describe(l.afterSnapshot),
    }));
  }, [audits, typeById, tagOf, isRange, week, year, months]);
}

/** 인쇄·PDF 저장 */
export function useReportExport(f: ReportFilters) {
  const [busy, setBusy] = useState(false);
  const [message, setMessageState] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedFileInfo | null>(null);

  // 안내 문구를 바꿀 때 이전 저장 파일 버튼은 함께 지웁니다(다른 문구 옆에 남지 않도록).
  const say = useCallback((text: string | null) => {
    setMessageState(text);
    setSaved(null);
  }, []);

  // 데스크톱 앱: PDF 저장이 끝나면 저장 위치를 받아 폴더를 열고 [파일 열기] 버튼을 보여 줍니다.
  useEffect(
    () =>
      desktop()?.onDownloadDone((info) => {
        setMessageState(`${info.name} 저장 완료 — 저장 폴더를 엽니다.`);
        setSaved(info);
        void desktop()?.showInFolder(info.path); // 저장이 끝나면 폴더를 자동으로 엽니다.
      }),
    [],
  );

  const openSaved = useCallback(async () => {
    if (!saved) return;
    const err = await desktop()?.openFile(saved.path);
    if (err) {
      setMessageState(`파일을 열지 못했습니다: ${err}`);
      setSaved(null);
    }
  }, [saved]);
  const showSaved = useCallback(async () => {
    if (saved) await desktop()?.showInFolder(saved.path);
  }, [saved]);

  // 종합 보고서는 합산 기준과 무관하므로 파일명에 넣지 않습니다(기준은 개인별·대표자별 탭 대표자 합산에서만 씁니다).
  const fileName = f.isDay
    ? `일별헌금보고서_${f.week.start}.pdf`
    : f.isWeek
    ? `주별헌금보고서_${f.week.start}_${f.week.end}.pdf`
    : f.personKind === 'MONTH'
      ? `월별헌금보고서_${f.year}-${String(f.periodValue).padStart(2, '0')}.pdf`
      : `헌금결산_${f.label}.pdf`;

  // 데스크톱 앱은 PDF 파일로 바로 저장하고, 웹 브라우저는 인쇄 창을 열어 '대상: PDF로 저장'을 선택하게 합니다.
  const savePdf = useCallback(async () => {
    const d = desktop();
    if (!d) {
      say("인쇄 창에서 대상을 'PDF로 저장'으로 선택하세요.");
      window.print();
      return;
    }
    setBusy(true);
    // 인쇄 중에만 전체 행을 그리는 화면이 있어, 인쇄와 같은 상태가 되도록 이벤트를 직접 보냅니다.
    window.dispatchEvent(new Event('beforeprint'));
    try {
      // 저장이 끝나면 main이 응답보다 먼저 download:done을 보내 완료 문구·[파일 열기]를 띄우므로 여기서 문구를 바꾸지 않습니다.
      await d.savePdf(fileName);
    } catch (err) {
      say(`PDF 저장 실패: ${(err as Error).message}`);
    } finally {
      window.dispatchEvent(new Event('afterprint'));
      setBusy(false);
    }
  }, [fileName, say]);

  const fileActions = saved
    ? [
        { label: '파일 열기', onClick: () => void openSaved() },
        { label: '폴더 열기', onClick: () => void showSaved() },
      ]
    : undefined;

  return { busy, message, fileActions, savePdf, print: () => window.print() };
}
