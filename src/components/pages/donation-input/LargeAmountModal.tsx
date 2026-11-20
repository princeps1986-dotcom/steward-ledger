import { memo } from 'react';
import { preventAutoFocus, type LargeAmountController } from '../../../hooks/useDonationInput';
import { formatWon } from '../../../services/domain/amount';
import { Modal } from '../../shared/Modal';
import { ConfirmFooter } from '../../shared/ConfirmFooter';

export const LargeAmountModal = memo(function LargeAmountModal({ large }: { large: LargeAmountController }) {
  const p = large.pending;
  return (
    <Modal
      open={!!p}
      onClose={large.onCancel}
      onCloseAutoFocus={preventAutoFocus}
      title="금액을 확인해 주세요"
      footer={
        <ConfirmFooter onCancel={large.onCancel} onConfirm={large.onConfirm} cancelLabel="다시 입력" autoFocus confirmLabel="확인" />
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
