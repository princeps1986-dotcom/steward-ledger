import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../contexts/types';
import { whatsNewAction } from './WhatsNewModal';

describe('whatsNewAction', () => {
  const notes = ['바뀐 점'];
  it('이전 버전을 본 사용자는 새 버전 첫 실행에 한 번 보여 주고, 확인 뒤에는 다시 띄우지 않습니다', () => {
    expect(whatsNewAction({ ...DEFAULT_SETTINGS, seenVersion: '1.0.0' }, '1.1.0', notes)).toBe('show');
    expect(whatsNewAction({ ...DEFAULT_SETTINGS, seenVersion: '1.1.0' }, '1.1.0', notes)).toBe('none');
  });
  it('기록이 없던 옛 버전 사용자도 백업 기록이 있으면 보여 줍니다', () => {
    expect(whatsNewAction({ ...DEFAULT_SETTINGS, lastCloseBackupAt: '2026-11-01T00:00:00Z' }, '1.1.0', notes)).toBe('show');
  });
  it('새로 설치했거나 이 버전의 변경 내역이 없으면 창 없이 기록만 합니다', () => {
    expect(whatsNewAction(DEFAULT_SETTINGS, '1.1.0', notes)).toBe('record');
    expect(whatsNewAction({ ...DEFAULT_SETTINGS, seenVersion: '1.0.0' }, '1.1.0', undefined)).toBe('record');
  });
});
