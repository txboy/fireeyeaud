import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleSlash, FileQuestion, MessageSquarePlus, Wrench, X } from 'lucide-react';
import type { EvidenceItem, Finding } from '@fireeyeaud/shared';
import { listEvidence } from '../lib/api';
import { useFindingsStore } from '../store/findings';

const REVIEWER = '审计员';

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const { t } = useTranslation('evidence');
  return (
    <div className="evidence-item">
      <Wrench size={12} strokeWidth={1.75} />
      <span className="evidence-item__tool">{item.tool ?? item.step}</span>
      <span className="evidence-item__step">{t(`step.${item.step}`)}</span>
      <span className="evidence-item__summary">{item.resultSummary ?? ''}</span>
      <span className="spacer" />
      <span className="evidence-item__ts">{item.ts.slice(11, 19)}</span>
    </div>
  );
}

export function FindingDetail({ finding }: { finding: Finding }) {
  const { t } = useTranslation('findings');
  const review = useFindingsStore((s) => s.review);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listEvidence(finding.id)
      .then((res) => setEvidence(res.items))
      .catch(() => setEvidence([]));
  }, [finding.id]);

  const act = async (body: Parameters<typeof review>[1]) => {
    setBusy(true);
    try {
      await review(finding.id, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="finding__detail">
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
          <X size={12} strokeWidth={2} /> {t('reject')}
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
                  : `${r.status ?? ''}${r.comment ? ` · ${r.comment}` : ''}`}
              </span>
              <span className="spacer" />
              <span className="review-row__ts">{r.ts?.slice(11, 19)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="evidence-block">
        <div className="evidence-block__title">{t('evidenceChain')}</div>
        {evidence.length === 0 ? (
          <div className="evidence-item evidence-item--empty">{t('noEvidence')}</div>
        ) : (
          evidence.map((item) => <EvidenceRow key={item.id} item={item} />)
        )}
      </div>

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
    </div>
  );
}
