import { memo } from 'react';
import { preventAutoFocus, type DuplicateController } from '../../../hooks/useDonationInput';
import { formatWon } from '../../../services/domain/amount';
import { Modal } from '../../shared/Modal';

export const DuplicateModal = memo(function DuplicateModal({ dup }: { dup: DuplicateController }) {
  const p = dup.pending;
  return (
    <Modal
      open={!!p}
      onClose={dup.onCancel}
      onCloseAutoFocus={preventAutoFocus}
      title="같은 날 같은 헌금이 이미 있습니다"
      description="봉투가 같은 헌금이면 합산하고, 별개 봉투(생일 감사 등)면 별도 건으로 추가하세요."
      footer={
        <>
          <button className="btn" onClick={dup.onCancel}>
            취소 (Esc)
          </button>
          <button className="btn" onClick={() => void dup.onResolve('SEPARATE')}>
            별도 건으로 추가 등록
          </button>
          <button className="btn-primary" autoFocus onClick={() => void dup.onResolve('MERGE')}>
            기존 내역에 금액 합산
          </button>
        </>
      }
    >
      <table className="w-full">
        <thead>
          <tr>
            <th className="th">헌금 종류</th>
            <th className="th text-right">기존 금액</th>
            <th className="th text-right">새 금액</th>
            <th className="th text-right">합산 시</th>
          </tr>
        </thead>
        <tbody>
          {p?.items.map((it) => (
            <tr key={it.existing.id}>
              <td className="td">{it.typeName}</td>
              <td className="td text-right">{formatWon(it.existing.amount)}</td>
              <td className="td text-right">{formatWon(it.newAmount)}</td>
              <td className="td text-right font-semibold">{formatWon(it.existing.amount + it.newAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500">겹치지 않는 다른 종류는 선택과 관계없이 새 건으로 저장됩니다. 합산은 감사 로그에 기록됩니다.</p>
    </Modal>
  );
});
