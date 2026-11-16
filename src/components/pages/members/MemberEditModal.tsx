import type { Member } from '../../../contexts/types';
import { useMemberForm } from '../../../hooks/useMemberForm';
import type { MemberDraft } from '../../../services/domain/memberRules';
import { MemberFormFields } from '../../shared/MemberFormFields';
import { Modal } from '../../shared/Modal';

interface Props {
  editor: { editingId?: string; initial: MemberDraft };
  onClose(): void;
  onSaved(m: Member): void;
}

export function MemberEditModal({ editor, onClose, onSaved }: Props) {
  const form = useMemberForm({ initial: editor.initial, editingId: editor.editingId, onSaved });
  return (
    <Modal open overflowVisible onClose={onClose} title={editor.editingId ? '성도 정보 수정' : '성도 등록'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.submit();
        }}
      >
        <MemberFormFields {...form} />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn-primary" disabled={form.saving}>
            저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
