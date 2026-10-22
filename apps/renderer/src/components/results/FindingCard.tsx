import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import type { Finding } from '@fireeyeaud/shared';
import { FindingDetail } from '../FindingDetail';
import { useUiStore } from '../../store/ui';
import { useFindingsStore } from '../../store/findings';
import { useConfirmStore } from '../../store/confirm';

/** 疑点卡片：勾选、展开详情、删除。 */
export function FindingCard({ finding }: { finding: Finding }) {
  const { t: ts } = useTranslation('enums');
  const { t } = useTranslation('findings');
  const { t: tc } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const selectedFindingId = useUiStore((s) => s.selectedFindingId);
  const setSelectedFindingId = useUiStore((s) => s.setSelectedFindingId);
  const selected = useFindingsStore((s) => s.selectedIds.includes(finding.id));
  const toggleSelected = useFindingsStore((s) => s.toggleSelected);
  const remove = useFindingsStore((s) => s.remove);
  const confirm = useConfirmStore((s) => s.confirm);
  const ref = useRef<HTMLDivElement>(null);

  const highlighted = selectedFindingId === finding.id;
  const title = finding.title?.text ?? finding.ruleKey ?? finding.id;
  const subjects = finding.subjects?.join('、') ?? '';
  const meta = [subjects, finding.amount].filter(Boolean).join(' · ');

  useEffect(() => {
    if (highlighted) {
      setOpen(true);
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setSelectedFindingId(finding.id);
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: t('deleteFinding'),
      message: t('deleteConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (ok) await remove(finding.id).catch(() => undefined);
  };

  return (
    <div
      ref={ref}
      className={`finding${open ? ' finding--open' : ''}${highlighted ? ' finding--selected' : ''}`}
    >
      <div className="finding__row">
        <input
          type="checkbox"
          className="finding__check"
          checked={selected}
          title={t('selectForForm')}
          aria-label={t('selectForForm')}
          onChange={() => toggleSelected(finding.id)}
        />
        <button
          type="button"
          className="finding__head"
          onClick={toggle}
          style={{ background: 'none', border: 'none', cursor: 'pointer', flex: 1, padding: 0 }}
        >
          {open ? (
            <ChevronDown size={13} strokeWidth={1.75} />
          ) : (
            <ChevronRight size={13} strokeWidth={1.75} />
          )}
          <span className={`severity severity--${finding.severity}`}>
            {ts(`severity.${finding.severity}`)}
          </span>
          <span className="finding__id">{finding.id}</span>
          {finding.origin === 'manual' && (
            <span className="tpl-badge">{t('manualBadge')}</span>
          )}
          <span className="spacer" />
          <span className="finding__status">{ts(`status.${finding.status}`)}</span>
        </button>
        <button
          type="button"
          className="icon-btn finding__delete"
          title={t('deleteFinding')}
          aria-label={t('deleteFinding')}
          onClick={() => void onDelete()}
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>

      <div className="finding__title">{title}</div>
      {finding.description?.text && (
        <div className="finding__desc">{finding.description.text}</div>
      )}
      {meta && <div className="finding__meta">{meta}</div>}
      {open && <FindingDetail finding={finding} />}
    </div>
  );
}