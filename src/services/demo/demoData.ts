import type { BackupPayload } from '../../contexts/types';
import { buildTestPayload } from '../../../scripts/testdata-core.mjs';
import { lastSunday } from '../domain/dates';

/**
 * 시연용 데이터(성도 150명 · 헌금 400건 · 수정/삭제 이력 6건).
 * 지난 주일(오늘이 일요일이면 오늘)을 '오늘'로 삼아, 종합 보고서 기본 주(지난 주일)에 데이터가 보이게 합니다.
 * 같은 날이면 항상 같은 내용입니다(고정 시드).
 */
export function buildDemoPayload(): BackupPayload {
  return buildTestPayload(lastSunday(), 20261116).payload as unknown as BackupPayload;
}
