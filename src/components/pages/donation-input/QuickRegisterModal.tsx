import { memo } from 'react';
import { preventAutoFocus, type QuickRegisterController } from '../../../hooks/useDonationInput';
import { useMemberForm } from '../../../hooks/useMemberForm';
import { EMPTY_MEMBER_DRAFT } from '../../../services/domain/memberRules';
import { MemberFormFields } from '../../shared/MemberFormFields';
import { Modal } from '../../shared/Modal';

function QuickRegisterForm({ qr }: { qr: QuickRegisterController }) {
  const form = useMemberForm({ initial: { ...EMPTY_MEMBER_DRAFT, name: qr.name }, onSaved: qr.onRegistered });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit();
      }}
    >
      <MemberFormFields {...form} />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={qr.onClose}>
          취소
        </button>
        <button type="submit" className="btn-primary" disabled={form.saving}>
          등록 후 선택
        </button>
      </div>
    </form>
  );
}

export const QuickRegisterModal = memo(function QuickRegisterModal({ qr }: { qr: QuickRegisterController }) {
  return (
    <Modal
      open={qr.open}
      overflowVisible
      onClose={qr.onClose}
      onCloseAutoFocus={preventAutoFocus}
      title="새 성도 즉시 등록"
      description="등록하면 바로 선택되고 금액 입력 칸으로 이동합니다."
    >
      {qr.open ? <QuickRegisterForm qr={qr} /> : null}
    </Modal>
  );
});
