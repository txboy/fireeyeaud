import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { message } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  Loader2,
} from 'lucide-react';
import type { ReportDocument, ReportVerifyResult } from '@fireeyeaud/shared';
import {
  exportReportDocument,
  verifyReportDocument,
} from '../../lib/api';
import { useWorkspaceStore } from '../../store/workspace';
import { useUiStore } from '../../store/ui';
import { useReportDocStore } from '../../store/reportWorkspace';

/** 右侧报告预览：大纲确认、结构化正文、校验与导出。 */
export function ReportPreview({
  doc,
  onRefresh,
}: {
  doc: ReportDocument;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('report');
  const { t: terr } = useTranslation('error');
  const wsPath = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);
  const saveOutline = useReportDocStore((s) => s.saveOutline);

  const [check, setCheck] = useState<ReportVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    setCheck(null);
    setErrorKey(null);
  }, [doc.body.updatedAt, doc.manifest.id]);

  const body = doc.body;
  const skeleton = doc.skeleton;
  const bodyStyle = skeleton.body ?? {};

  const runVerify = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await verifyReportDocument(doc.manifest.id);
      setCheck(result);
    } catch (err) {
      setErrorKey((err as { messageKey?: string }).messageKey ?? 'error.internal');
    } finally {
      setBusy(false);
    }
  };

  const exportWord = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const manifest = await exportReportDocument(doc.manifest.id);
      if (manifest.exportWarnings && manifest.exportWarnings.length > 0) {
        void message.warning(manifest.exportWarnings.join('；'));
      } else {
        void message.success(t('exported', { name: `${manifest.title}.docx` }));
      }
      onRefresh();
    } catch (err) {
      const key = (err as { messageKey?: string }).messageKey ?? 'error.internal';
      setErrorKey(key);
      if (key === 'error.reportVerifyFailed') await runVerify();
    } finally {
      setBusy(false);
    }
  };

  const hasCurrentDocx =
    doc.manifest.status === 'saved' &&
    doc.manifest.files.includes('document.docx');

  const docxPath = () => `${wsPath}/${doc.manifest.artifactRef}/document.docx`;

  const openDocx = () => {
    if (!wsPath || !hasCurrentDocx) return;
    void openPreview(wsPath, docxPath(), `${doc.manifest.id}.docx`);
  };

  return (
    <section className="report-preview">
      <div className="report-preview__head">
        <div className="report-preview__heading">
          <div className="report-preview__title">{body.title}</div>
          <div className="card__meta">
            {t('templateSkeleton', {
              name: doc.manifest.templateName || '—',
              size: String(bodyStyle.size ?? '—'),
              font: String(bodyStyle.eastAsia ?? bodyStyle.font ?? '—'),
            })}
          </div>
        </div>
        <div className="report-preview__actions">
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy}
            onClick={() => void runVerify()}
          >
            <FileCheck2 size={12} strokeWidth={1.9} /> {t('verify')}
          </button>
          <button
            type="button"
            className="button button--sm button--ghost"
            disabled={busy || !hasCurrentDocx}
            title={hasCurrentDocx ? undefined : t('needExport')}
            onClick={openDocx}
          >
            <ExternalLink size={12} strokeWidth={1.9} /> {t('openDocx')}
          </button>
          <button
            type="button"
            className="button button--sm"
            disabled={busy}
            onClick={() => void exportWord()}
          >
            {busy ? (
              <Loader2 size={12} className="spin" />
            ) : (
              <Download size={12} strokeWidth={1.9} />
            )}
            {t('exportWord')}
          </button>
        </div>
      </div>

      {!body.outlineApproved && body.sections.length > 0 && (
        <div className="report-outline-banner">
          <div>
            <div className="report-outline-banner__title">{t('outlinePending')}</div>
            <div className="card__meta">{t('outlineHint')}</div>
          </div>
          <button
            type="button"
            className="button button--sm"
            onClick={() => void saveOutline(doc.manifest.id, true)}
          >
            {t('confirmOutline')}
          </button>
        </div>
      )}

      {errorKey && (
        <div className="panel-error">{terr(errorKey.replace(/^error\./, ''))}</div>
      )}

      {check && (
        <div className={`report-verify${check.ok ? ' report-verify--ok' : ''}`}>
          <div className="report-verify__head">
            {check.ok ? (
              <>
                <CheckCircle2 size={13} /> {t('verifyOk')}
              </>
            ) : (
              <>
                <AlertTriangle size={13} /> {t('verifyFailed', { count: check.errors.length })}
              </>
            )}
            {check.warnings.length > 0 && (
              <span className="card__meta">
                {t('verifyWarnings', { count: check.warnings.length })}
              </span>
            )}
          </div>
          {check.errors.map((issue, index) => (
            <div key={`e-${index}`} className="report-verify__issue">
              {issue.message}
            </div>
          ))}
          {check.warnings.map((issue, index) => (
            <div key={`w-${index}`} className="report-verify__issue report-verify__issue--warn">
              {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="report-preview__body">
        {body.sections.length === 0 ? (
          <div className="panel-empty">
            <span>{t('emptySections')}</span>
          </div>
        ) : (
          body.sections.map((section) => (
            <article key={section.id} className="report-section">
              <h3
                className={`report-section__title report-section__title--l${section.level}`}
              >
                {section.title}
              </h3>
              {section.blocks.length === 0 ? (
                <div className="report-section__empty">{t('sectionEmpty')}</div>
              ) : (
                section.blocks.map((block, index) => {
                  if (block.type === 'paragraph') {
                    return (
                      <p key={index} className="report-section__para">
                        {block.text}
                        <Refs refs={block.sourceRefs} label={t('source')} />
                      </p>
                    );
                  }
                  if (block.type === 'bullets') {
                    return (
                      <ul key={index} className="report-section__list">
                        {block.items.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                        <Refs refs={block.sourceRefs} label={t('source')} />
                      </ul>
                    );
                  }
                  return (
                    <div key={index} className="report-table-wrap">
                      <table className="report-table">
                        <thead>
                          <tr>
                            {block.columns.map((column) => (
                              <th key={column}>{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {row.map((cell, cellIndex) => (
                                <td key={cellIndex}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <Refs refs={block.sourceRefs} label={t('source')} />
                    </div>
                  );
                })
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function Refs({ refs, label }: { refs: string[]; label: string }) {
  if (!refs || refs.length === 0) return null;
  return (
    <span className="report-refs">
      {refs.map((ref) => (
        <span key={ref} className="report-ref" title={label}>
          {ref}
        </span>
      ))}
    </span>
  );
}
