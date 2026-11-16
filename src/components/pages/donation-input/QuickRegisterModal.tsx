import type { DonationInputController } from '../../../hooks/useDonationInput';
import { useMemberForm } from '../../../hooks/useMemberForm';
import { EMPTY_MEMBER_DRAFT } from '../../../services/domain/memberRules';
import { MemberFormFields } from '../../shared/MemberFormFields';
import { Modal } from '../../shared/Modal';

function QuickRegisterForm({ c }: { c: DonationInputController }) {
  const form = useMemberForm({ initial: { ...EMPTY_MEMBER_DRAFT, name: c.quickRegisterName }, onSaved: c.onQuickRegistered });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.submit();
      }}
    >
      <MemberFormFields {...form} />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={c.closeQuickRegister}>
          취소
        </button>
        <button type="submit" className="btn-primary" disabled={form.saving}>
          등록 후 선택
        </button>
      </div>
    </form>
  );
}

export function QuickRegisterModal({ c }: { c: DonationInputController }) {
  return (
    <Modal
      open={c.quickRegisterOpen}
      overflowVisible
      onClose={c.closeQuickRegister}
      onCloseAutoFocus={c.preventAutoFocus}
      title="새 성도 즉시 등록"
      description="등록하면 바로 선택되고 금액 입력 칸으로 이동합니다."
    >
      {c.quickRegisterOpen ? <QuickRegisterForm c={c} /> : null}
    </Modal>
  );
}
