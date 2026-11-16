import type { DonationInputController } from '../../../hooks/useDonationInput';
import { formatWon } from '../../../services/domain/amount';
import { Modal } from '../../shared/Modal';

export function LargeAmountModal({ c }: { c: DonationInputController }) {
  const p = c.pendingLarge;
  return (
    <Modal
      open={!!p}
      onClose={c.cancelLarge}
      onCloseAutoFocus={c.preventAutoFocus}
      title="금액을 확인해 주세요"
      footer={
        <>
          <button className="btn" onClick={c.cancelLarge}>
            다시 입력
          </button>
          <button className="btn-primary" autoFocus onClick={() => void c.confirmLarge()}>
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
}
