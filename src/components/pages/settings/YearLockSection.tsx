import { useState } from 'react';
import { useDonationYears } from '../../../contexts/DonationContext';
import { useSettings, useSettingsActions } from '../../../contexts/SettingsContext';
import { allowed } from '../../../services/auth/access';
import { ConfirmFooter } from '../../shared/ConfirmFooter';
import { Modal } from '../../shared/Modal';
import { Notice } from '../../shared/Notice';

/** 연도 잠금(마감): 잠긴 연도는 헌금 입력·수정·삭제가 막힙니다. 걸기는 관리자·재정담당, 풀기는 관리자만. */
export function YearLockSection() {
  const { lockedYears } = useSettings();
  const { update } = useSettingsActions();
  const years = useDonationYears();
  const [error, setError] = useState<string | null>(null);
  // 잠그기·잠금 풀기 전 확인(실수로 누르지 않게)
  const [asking, setAsking] = useState<{ year: string; lock: boolean } | null>(null);
  const canUnlock = allowed('year:unlock');
  const all = [...new Set([...years, ...lockedYears])].sort().reverse();

  const toggle = async (year: string, lock: boolean) => {
    setError(null);
    try {
      // 화면의 목록이 아니라 저장된 최신 목록에서 한 해만 더하거나 뺍니다(연달아 눌러도 앞의 잠금이 풀리지 않게).
      await update((cur) => ({ lockedYears: lock ? [...new Set([...cur.lockedYears, year])].sort() : cur.lockedYears.filter((y) => y !== year) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="card space-y-3">
      <h3 className="font-semibold">
        연도 잠금 <span className="ml-1 text-xs font-normal text-gray-500">마감한 연도의 헌금을 실수로 고치지 않도록 막습니다</span>
      </h3>
      <Notice message={error ? { kind: 'error', text: error } : null} />
      {all.length === 0 ? <p className="text-sm text-gray-500">헌금이 있는 연도가 없습니다.</p> : null}
      <ul className="divide-y divide-gray-100">
        {all.map((y) => {
          const locked = lockedYears.includes(y);
          return (
            <li key={y} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                {y}년 <span className={locked ? 'font-semibold text-red-700' : 'text-gray-500'}>{locked ? '잠김' : '열림'}</span>
              </span>
              {locked ? (
                canUnlock ? (
                  // 더블클릭의 두 번째 클릭(detail > 1)은 무시: 같은 자리에 바뀌어 나온 반대 단추가 눌리지 않게
                  <button type="button" className="btn" onClick={(e) => e.detail > 1 || setAsking({ year: y, lock: false })}>
                    잠금 풀기
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">풀려면 관리자에게 요청하세요</span>
                )
              ) : (
                <button type="button" className="btn" onClick={(e) => e.detail > 1 || setAsking({ year: y, lock: true })}>
                  잠그기
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Modal
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking ? `${asking.year}년을 ${asking.lock ? '잠글까요?' : '잠금 풀까요?'}` : ''}
        footer={
          <ConfirmFooter
            onCancel={() => setAsking(null)}
            onConfirm={async () => {
              if (asking) await toggle(asking.year, asking.lock);
              setAsking(null);
            }}
            confirmLabel={asking?.lock === false ? '잠금 풀기' : '잠그기'}
          />
        }
      >
        <p className="text-sm leading-relaxed text-gray-700">
          {asking?.lock === false
            ? '풀면 그해 헌금을 다시 입력·수정·삭제할 수 있습니다. 고칠 일이 끝나면 다시 잠그세요.'
            : `잠그면 그해 헌금을 입력·수정·삭제할 수 없습니다. ${canUnlock ? '[잠금 풀기]로 다시 열 수 있습니다.' : '잠금은 관리자만 풀 수 있습니다.'}`}
        </p>
      </Modal>
      <p className="text-xs text-gray-500">백업 복원·전체 초기화는 잠긴 연도도 바꿉니다(관리자만 할 수 있습니다).</p>
    </section>
  );
}
