import { useState } from 'react';
import { useDonationActions } from '../../../contexts/DonationContext';
import { monthsBetween } from '../../../services/domain/dates';
import { validateReason } from '../../../services/domain/donationOps';
import { countDonationsBetween } from '../../../services/storage/storageService';
import { ConfirmFooter } from '../../shared/ConfirmFooter';
import { Modal } from '../../shared/Modal';
import { Notice } from '../../shared/Notice';

/** 기간 헌금 일괄 삭제(관리자 전용): 달 범위와 사유를 받고, 지울 건수를 보여 준 뒤 확인을 받아 지웁니다. 건마다 수정·삭제 이력이 남습니다. */
export function PeriodDeleteSection() {
  const { deletePeriod } = useDonationActions();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [count, setCount] = useState<number | null>(null); // 확인창에 보여 줄 지울 건수(null이면 창 닫힘)
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  const ask = async () => {
    setMessage(null);
    try {
      monthsBetween(from, to);
      const bad = validateReason(reason);
      if (bad) throw new Error(bad);
      const n = await countDonationsBetween(from, to);
      if (n === 0) throw new Error('이 기간에는 지울 헌금이 없습니다.');
      setCount(n);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const n = await deletePeriod(from, to, reason);
      setMessage({ kind: 'info', text: `${from} ~ ${to}의 헌금 ${n.toLocaleString()}건을 지웠습니다. 수정·삭제 이력에서 확인할 수 있습니다.` });
      setReason('');
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setCount(null);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4">
      <h3 className="flex items-center gap-1.5 font-semibold text-red-700">
        <span aria-hidden="true">⚠</span> 기간 헌금 삭제
      </h3>
      <p className="text-sm text-red-700">선택한 달 범위의 헌금을 모두 지웁니다. 성도·헌금 종류는 지워지지 않고, 지운 헌금은 이력에 남습니다. 지우기 전에 백업 파일을 만들어 두세요.</p>
      <Notice message={message} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          시작 달
          <input type="month" className="input mt-1 block" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          끝 달
          <input type="month" className="input mt-1 block" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="grow text-sm">
          삭제 사유 (한글 4글자 이상)
          <input className="input mt-1 block w-full" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="button" className="btn-danger whitespace-nowrap" disabled={busy || !from || !to || !reason.trim()} onClick={() => void ask()}>
          삭제…
        </button>
      </div>
      <Modal
        open={count !== null}
        onClose={() => !busy && setCount(null)}
        title="기간 헌금 삭제 확인"
        footer={<ConfirmFooter busy={busy} confirmLabel="삭제" tone="danger" onCancel={() => setCount(null)} onConfirm={() => void run()} />}
      >
        <p className="text-sm">
          {from} ~ {to}의 헌금 <b>{count?.toLocaleString()}건</b>이 지워지고 되돌릴 수 없습니다. 사유: {reason.trim()}
        </p>
      </Modal>
    </section>
  );
}
