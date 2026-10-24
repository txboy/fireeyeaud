import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { JSONContent, Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { Input, message } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  ExternalLink,
  FileCheck2,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import type {
  ReportBlock,
  ReportTextRun,
  ReportVerifyResult,
} from '@fireeyeaud/shared';
import {
  exportFormDocument,
  exportReportDocument,
  setFormOutline,
  setFormTitle,
  setReportOutline,
  setReportTitleApi,
  verifyFormDocument,
  verifyReportDocument,
  writeFormSection,
  writeReportSection,
} from '../../lib/api';
import { useWorkspaceStore } from '../../store/workspace';
import { useUiStore } from '../../store/ui';
import { useDocStore } from '../../store/workspaceDocs';
import type { WorkspaceDocument } from '../../store/reportWorkspace';
import type { WorkspaceKind } from '../../store/workspaceKind';
import { useConfirmStore } from '../../store/confirm';
import { ReportEditorToolbar } from '../reports/ReportEditorToolbar';
import { ReportSectionEditor } from '../reports/ReportSectionEditor';
import { sectionFromTiptap } from '../reports/editor/reportEditorModel';

/**
 * 右侧写作台预览：大纲确认、结构化正文、校验与导出；支持章节富文本编辑。
 * 报告与取证单共用，按 kind 切换数据接口与文案命名空间。
 */
export function WorkspacePreview({
  kind,
  doc,
  onRefresh,
}: {
  kind: WorkspaceKind;
  doc: WorkspaceDocument;
  onRefresh: () => void;
}) {
  const { t } = useTranslation(kind === 'report' ? 'report' : 'evidence-form');
  const { t: tc } = useTranslation('common');
  const { t: terr } = useTranslation('error');
  const wsPath = useWorkspaceStore((s) => s.path);
  const openPreview = useUiStore((s) => s.openPreview);
  const store = useDocStore(kind);
  const saveOutline = store((s) => s.saveOutline);
  const confirm = useConfirmStore((s) => s.confirm);

  const [check, setCheck] = useState<ReportVerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draftTitle, setDraftTitle] = useState(doc.body.title);
  const [draftSectionTitles, setDraftSectionTitles] = useState<Record<string, string>>({});
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const [, forceToolbar] = useState(0);

  const editorsRef = useRef(new Map<string, Editor>());

  const body = doc.body;
  const skeleton = doc.skeleton;
  const bodyStyle = skeleton.body ?? {};

  useEffect(() => {
    setCheck(null);
    setErrorKey(null);
  }, [body.updatedAt, doc.manifest.id]);

  useEffect(() => {
    if (!activeEditor) return;
    const refreshToolbar = () => forceToolbar((value) => value + 1);
    activeEditor.on('transaction', refreshToolbar);
    activeEditor.on('selectionUpdate', refreshToolbar);
    return () => {
      activeEditor.off('transaction', refreshToolbar);
      activeEditor.off('selectionUpdate', refreshToolbar);
    };
  }, [activeEditor]);

  const runVerify = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const result =
        kind === 'report'
          ? await verifyReportDocument(doc.manifest.id)
          : await verifyFormDocument(doc.manifest.id);
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
      const manifest =
        kind === 'report'
          ? await exportReportDocument(doc.manifest.id)
          : await exportFormDocument(doc.manifest.id);
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
    doc.manifest.status === 'saved' && doc.manifest.files.includes('document.docx');

  const docxPath = () => `${wsPath}/${doc.manifest.artifactRef}/document.docx`;

  const openDocx = () => {
    if (!wsPath || !hasCurrentDocx) return;
    void openPreview(wsPath, docxPath(), `${doc.manifest.id}.docx`);
  };

  const startEdit = () => {
    setDraftTitle(body.title);
    setDraftSectionTitles(
      Object.fromEntries(body.sections.map((section) => [section.id, section.title])),
    );
    setDirty(false);
    setEditing(true);
  };

  const cancelEdit = async () => {
    if (dirty) {
      const ok = await confirm({
        title: t('discardTitle'),
        message: t('discardMessage'),
        confirmLabel: tc('confirm'),
        cancelLabel: tc('cancel'),
        danger: true,
      });
      if (!ok) return;
    }
    setEditing(false);
    setDirty(false);
    setActiveEditor(null);
    editorsRef.current.clear();
  };

  const handleReady = useCallback((sectionId: string, editor: Editor | null) => {
    if (editor) {
      editorsRef.current.set(sectionId, editor);
      setActiveEditor((current) => current ?? editor);
    } else {
      editorsRef.current.delete(sectionId);
    }
  }, []);

  const handleFocus = useCallback((editor: Editor) => {
    setActiveEditor(editor);
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  const save = useCallback(async () => {
    if (saving) return;
    const title = draftTitle.trim();
    if (!title) {
      void message.warning(t('titleRequired'));
      return;
    }

    setSaving(true);
    setErrorKey(null);
    try {
      const writeSection =
        kind === 'report' ? writeReportSection : writeFormSection;
      for (const section of body.sections) {
        const editor = editorsRef.current.get(section.id);
        if (!editor) continue;
        const blocks = sectionFromTiptap(editor.getJSON().content as JSONContent[] | undefined);
        await writeSection(doc.manifest.id, section.id, blocks);
      }

      const nextSections = body.sections.map((section) => ({
        id: section.id,
        title: (draftSectionTitles[section.id] ?? section.title).trim() || section.title,
        level: section.level,
        goal: section.goal,
      }));
      const sectionTitleChanged = nextSections.some(
        (section, index) => section.title !== body.sections[index].title,
      );
      if (sectionTitleChanged) {
        const setOutline = kind === 'report' ? setReportOutline : setFormOutline;
        await setOutline(doc.manifest.id, nextSections, body.outlineApproved);
      }
      if (title !== body.title) {
        const setTitle = kind === 'report' ? setReportTitleApi : setFormTitle;
        await setTitle(doc.manifest.id, title);
      }

      setEditing(false);
      setDirty(false);
      setActiveEditor(null);
      editorsRef.current.clear();
      void message.success(t('savedChanges'));
      onRefresh();
    } catch (err) {
      const key = (err as { messageKey?: string }).messageKey ?? 'error.internal';
      setErrorKey(key);
      void message.error(terr(key.replace(/^error\./, '')));
    } finally {
      setSaving(false);
    }
  }, [
    body.outlineApproved,
    body.sections,
    body.title,
    doc.manifest.id,
    draftSectionTitles,
    draftTitle,
    kind,
    onRefresh,
    saving,
    t,
    terr,
  ]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing]);

  return (
    <section className="report-preview">
      <div className="report-preview__head">
        <div className="report-preview__heading">
          {editing ? (
            <Input
              className="report-preview__title-input"
              value={draftTitle}
              placeholder={t('titlePlaceholder')}
              onChange={(event) => {
                setDraftTitle(event.target.value);
                setDirty(true);
              }}
            />
          ) : (
            <div className="report-preview__title">{body.title}</div>
          )}
          <div className="card__meta">
            {t('templateSkeleton', {
              name: doc.manifest.templateName || '—',
              size: String(bodyStyle.size ?? '—'),
              font: String(bodyStyle.eastAsia ?? bodyStyle.font ?? '—'),
            })}
          </div>
        </div>
        <div className="report-preview__actions">
          {editing ? (
            <>
              <button
                type="button"
                className="button button--sm button--ghost"
                disabled={saving}
                onClick={() => void cancelEdit()}
              >
                <X size={12} strokeWidth={1.9} /> {tc('cancel')}
              </button>
              <button
                type="button"
                className="button button--sm"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <Save size={12} strokeWidth={1.9} />
                )}
                {t('save')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button button--sm button--ghost"
                disabled={busy}
                onClick={startEdit}
              >
                <Edit3 size={12} strokeWidth={1.9} /> {tc('edit')}
              </button>
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
            </>
          )}
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

      {editing && <ReportEditorToolbar editor={activeEditor} />}

      <div className="report-preview__body">
        {body.sections.length === 0 ? (
          <div className="panel-empty">
            <span>{t('emptySections')}</span>
          </div>
        ) : editing ? (
          body.sections.map((section) => (
            <ReportSectionEditor
              key={section.id}
              section={section}
              title={draftSectionTitles[section.id] ?? section.title}
              onTitleChange={(value) => {
                setDraftSectionTitles((current) => ({ ...current, [section.id]: value }));
                setDirty(true);
              }}
              onReady={handleReady}
              onFocus={handleFocus}
              onDirty={markDirty}
            />
          ))
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
                section.blocks.map((block, index) => (
                  <ReportBlockView key={index} block={block} />
                ))
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ReportBlockView({ block }: { block: ReportBlock }) {
  if (block.type === 'paragraph') {
    return (
      <p className="report-section__para" style={block.align ? { textAlign: block.align } : undefined}>
        <RichText text={block.text} runs={block.runs} />
        <Refs refs={block.sourceRefs} label="" />
      </p>
    );
  }
  if (block.type === 'bullets') {
    return (
      <div className="report-block-wrap">
        <ul className="report-section__list">
          {block.items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              style={
                block.itemAlign?.[itemIndex]
                  ? { textAlign: block.itemAlign[itemIndex] }
                  : undefined
              }
            >
              <RichText text={item} runs={block.itemRuns?.[itemIndex]} />
            </li>
          ))}
        </ul>
        <Refs refs={block.sourceRefs} label="" />
      </div>
    );
  }
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            {block.columns.map((column, index) => (
              <th
                key={index}
                style={
                  block.columnAlign?.[index]
                    ? { textAlign: block.columnAlign[index] }
                    : undefined
                }
              >
                <RichText text={column} runs={block.columnRuns?.[index]} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={
                    block.rowAlign?.[rowIndex]?.[cellIndex]
                      ? { textAlign: block.rowAlign[rowIndex][cellIndex] }
                      : undefined
                  }
                >
                  <RichText text={cell} runs={block.rowRuns?.[rowIndex]?.[cellIndex]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Refs refs={block.sourceRefs} label="" />
    </div>
  );
}

function RichText({ text, runs }: { text: string; runs?: ReportTextRun[] }) {
  if (!runs || runs.length === 0) return <>{text}</>;
  return (
    <>
      {runs.map((run, index) => {
        let node: ReactNode = run.text;
        if (run.underline) node = <u>{node}</u>;
        if (run.italic) node = <em>{node}</em>;
        if (run.bold) node = <strong>{node}</strong>;
        return <Fragment key={index}>{node}</Fragment>;
      })}
    </>
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