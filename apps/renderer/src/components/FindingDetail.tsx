import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  CircleSlash,
  ClipboardCheck,
  FileQuestion,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react';
import type { EvidenceItem, Finding } from '@fireeyeaud/shared';
import { listEvidence, removeFindingEvidenceApi } from '../lib/api';
import { useFindingsStore } from '../store/findings';
import { useWorkspaceStore } from '../store/workspace';
import { useUiStore } from '../store/ui';
import { useConfirmStore } from '../store/confirm';
import { AddEvidenceDialog } from './results/AddEvidenceDialog';
import { errorKeyOf } from '../lib/errorKey';

const REVIEWER = '审计员';

/** 桌面端预览支持的文件类型（与 file-preview.cjs 对齐）。 */
const PREVIEWABLE_EXT = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.docx',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
]);
const PREVIEW_MAX_BYTES = 30 * 1024 * 1024;

function EvidenceIcon({ item }: { item: EvidenceItem }) {
  if (item.kind === 'file') return <Paperclip size={12} strokeWidth={1.75} />;
  if (item.kind === 'record') return <ClipboardCheck size={12} strokeWidth={1.75} />;
  if (item.kind === 'text') return <MessageSquare size={12} strokeWidth={1.75} />;
  return <ClipboardCheck size={12} strokeWidth={1.75} />;
}

function EvidenceRow({
  item,
  onRemove,
}: {
  item: EvidenceItem;
  onRemove: (item: EvidenceItem) => void;
}) {
  const { t } = useTranslation('findings');
  const { t: te } = useTranslation('evidence');
  const root = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);

  const label = item.title ?? item.resultSummary ?? item.tool ?? te(`step.${item.step}`);

  // 只给桌面端能渲染的格式显示预览；.doc/.xls/.zip 等会被判为 unsupported。
  const ext = (item.filePath ?? '').toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const size = Number((item.params as { size?: number } | undefined)?.size ?? 0);
  const canPreview =
    Boolean(item.filePath) &&
    PREVIEWABLE_EXT.has(ext) &&
    (!size || size <= PREVIEW_MAX_BYTES);

  return (
    <div className="evidence-item">
      <EvidenceIcon item={item} />
      <div className="evidence-item__main">
        <span className="evidence-item__title">{label}</span>
        {item.note && <span className="evidence-item__note">{item.note}</span>}
        <span className="evidence-item__note">
          {item.filePath ? `${item.filePath} · ` : ''}
          {te(`step.${item.step}`)} · {item.ts.slice(11, 19)}
        </span>
      </div>
      <span className="spacer" />
      <div className="evidence-item__actions">
        {canPreview && root && (
          <button
            type="button"
            className="button button--sm button--ghost"
            onClick={() => {
              const filePath = item.filePath;
              if (!filePath) return;
              void openPreview(
                root,
                `${root}/${filePath}`,
                filePath.split('/').pop() ?? item.id,
              );
            }}
          >
            {t('preview')}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          title={t('removeEvidence')}
          aria-label={t('removeEvidence')}
          onClick={() => onRemove(item)}
        >
          <Trash2 size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

/** 疑点详情：上「疑点内容」，下「证据」。 */
export function FindingDetail({ finding }: { finding: Finding }) {
  const { t } = useTranslation('findings');
  const { t: ts } = useTranslation('enums');
  const { t: tc } = useTranslation('common');
  const review = useFindingsStore((s) => s.review);
  const reloadFindings = useFindingsStore((s) => s.load);
  const confirm = useConfirmStore((s) => s.confirm);

  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const { t: terr } = useTranslation('error');

  const refsKey = (finding.evidenceRefs ?? []).join(',');

  const loadEvidence = () => {
    void listEvidence(finding.id)
      .then((res) => setEvidence(res.items))
      .catch(() => setEvidence([]));
  };

  useEffect(() => {
    loadEvidence();
    // 挂接/摘除后 evidenceRefs 变化，需要重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding.id, refsKey]);

  const act = async (body: Parameters<typeof review>[1]) => {
    setBusy(true);
    try {
      await review(finding.id, body);
    } finally {
      setBusy(false);
    }
  };

  const onRemoveEvidence = async (item: EvidenceItem) => {
    const ok = await confirm({
      title: t('removeEvidence'),
      message: t('removeEvidenceConfirm'),
      confirmLabel: tc('delete'),
      cancelLabel: tc('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFindingEvidenceApi(finding.id, item.id);
      await reloadFindings();
    } catch (err) {
      setErrorKey(errorKeyOf(err));
    }
  };

  return (
    <div className="finding__detail finding__detail--split">
      {/* 上：疑点内容 */}
      <section className="finding__content">
        <div className="finding__content-title">{t('detailContent')}</div>
        {finding.description?.text && (
          <div className="finding__desc">{finding.description.text}</div>
        )}
        <div className="finding__meta">
          {[
            (finding.subjects ?? []).join('、'),
            finding.amount ? `${finding.amount} ${finding.currency ?? 'CNY'}` : '',
            finding.ruleKey ?? '',
            finding.sessionId ?? '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>

        <div className="review-row">
          <button
            type="button"
            className="button button--sm"
            disabled={busy}
            onClick={() => void act({ action: 'confirm', reviewer: REVIEWER })}
          >
            <Check size={12} strokeWidth={2} /> {t('confirm')}
          </button>
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy}
            onClick={() => void act({ action: 'reject', reviewer: REVIEWER })}
          >
            <CircleSlash size={12} strokeWidth={2} /> {t('reject')}
          </button>
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy}
            onClick={() => void act({ action: 'mark', reviewer: REVIEWER })}
          >
            <FileQuestion size={12} strokeWidth={2} /> {t('mark')}
          </button>
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy}
            onClick={() => void act({ action: 'false_positive', reviewer: REVIEWER })}
          >
            <CircleSlash size={12} strokeWidth={2} /> {t('falsePositive')}
          </button>
        </div>

        {(finding.reviews?.length ?? 0) > 0 && (
          <div className="review-history">
            {finding.reviews?.map((r, i) => (
              <div key={i} className="review-row review-row--history">
                <span className="review-row__who">{r.reviewer}</span>
                <span className="review-row__what">
                  {r.event === 'severity_changed'
                    ? `${r.severity ?? ''}${r.comment ? ` · ${r.comment}` : ''}`
                    : `${r.status ? ts(`status.${r.status}`) : ''}${
                        r.comment ? ` · ${r.comment}` : ''
                      }`}
                </span>
                <span className="spacer" />
                <span className="review-row__ts">{r.ts?.slice(11, 19)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="review-row">
          <input
            className="searchbox"
            value={note}
            placeholder={t('addNote')}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="button button--sm"
            disabled={busy || !note.trim()}
            onClick={() => {
              void act({ action: 'note', reviewer: REVIEWER, note: note.trim() });
              setNote('');
            }}
          >
            <MessageSquarePlus size={12} strokeWidth={2} />
          </button>
        </div>
      </section>

      {/* 下：证据 */}
      <section className="finding__evidence">
        <div className="evidence-block__title">
          <span>{t('detailEvidence')}</span>
          <span className="spacer" />
          <button
            type="button"
            className="button button--sm"
            onClick={() => setAddOpen(true)}
          >
            <Plus size={12} strokeWidth={2} /> {t('addEvidence')}
          </button>
        </div>
        {evidence.length === 0 ? (
          <div className="evidence-item evidence-item--empty">{t('noEvidence')}</div>
        ) : (
          evidence.map((item) => (
            <EvidenceRow
              key={item.id}
              item={item}
              onRemove={(target) => void onRemoveEvidence(target)}
            />
          ))
        )}
        {errorKey && (
          <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
        )}
      </section>

      <AddEvidenceDialog
        open={addOpen}
        findingId={finding.id}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          loadEvidence();
          void reloadFindings();
        }}
      />
    </div>
  );
}