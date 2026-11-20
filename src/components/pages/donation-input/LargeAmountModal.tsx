import { memo } from 'react';
import { preventAutoFocus, type LargeAmountController } from '../../../hooks/useDonationInput';
import { formatWon } from '../../../services/domain/amount';
import { Modal } from '../../shared/Modal';

export const LargeAmountModal = memo(function LargeAmountModal({ large }: { large: LargeAmountController }) {
  const p = large.pending;
  return (
    <Modal
      open={!!p}
      onClose={large.onCancel}
      onCloseAutoFocus={preventAutoFocus}
      title="금액을 확인해 주세요"
      footer={
        <>
          <button className="btn" onClick={large.onCancel}>
            다시 입력
          </button>
          <button className="btn-primary" autoFocus onClick={() => void large.onConfirm()}>
            확인
          </button>
        </>
      }
    >
      <ul className="space-y-1 text-sm">
        {p?.items.map((it, i) => (
          <li key={i}>
            {it.typeName}: <b className="text-red-600">{formatWon(it.amount)}</b> 입니다. 맞습니까?
          </li>
        ))}
      </ul>
    </Modal>
  );
});
