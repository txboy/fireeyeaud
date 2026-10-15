import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Cpu, Database, Plug, ShieldCheck, Sparkles, X } from 'lucide-react';
import { EMPTY_CONTEXT, type ChatContext } from '../lib/api';
import { useChatStore } from '../store/chat';
import { useModelsStore } from '../store/models';
import { useMcpStore } from '../store/mcp';
import { useSkillsStore } from '../store/skills';
import { useDatabaseStore } from '../store/database';
import { useKnowledgeStore } from '../store/knowledge';
import { useRulesStore } from '../store/rules';

interface Option {
  id: string;
  name: string;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** 单个模块按钮 + 锚定弹层（多选该模块的非默认资源）。 */
function ModuleMenu({
  icon: Icon,
  label,
  options,
  selected,
  disabled,
  onToggle,
  onClear,
}: {
  icon: LucideIcon;
  label: string;
  options: Option[];
  selected: string[];
  disabled: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('agent');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = options.filter((o) => selected.includes(o.id)).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ctx-menu" ref={ref}>
      <button
        type="button"
        className={`ctx-btn${count > 0 ? ' ctx-btn--on' : ''}`}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={13} strokeWidth={1.75} />
        <span className="ctx-btn__label">{label}</span>
        {count > 0 && <span className="ctx-btn__count">{count}</span>}
      </button>
      {open && (
        <div className="ctx-pop" role="menu">
          <div className="ctx-pop__head">
            <span>{label}</span>
            {count > 0 && <span className="ctx-pop__count">{count}</span>}
          </div>
          <div className="ctx-pop__list">
            {options.length === 0 ? (
              <span className="ctx-pop__empty">{t('resNoItems')}</span>
            ) : (
              options.map((opt) => (
                <label key={opt.id} className="ctx-pop__item">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.id)}
                    onChange={() => onToggle(opt.id)}
                  />
                  <span>{opt.name}</span>
                </label>
              ))
            )}
          </div>
          {options.length > 0 && (
            <button
              type="button"
              className="ctx-pop__clear"
              disabled={count === 0}
              onClick={onClear}
            >
              <X size={12} strokeWidth={2} /> {t('resClear')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 输入框上方的会话上下文栏：单选模型 + 各模块按钮（点开多选非默认资源）。 */
export function ContextBar({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('agent');
  const chat = useChatStore((s) => s.chats[sessionId]);
  const setContext = useChatStore((s) => s.setContext);
  const setModel = useChatStore((s) => s.setModel);
  const context = chat?.context ?? EMPTY_CONTEXT;
  const modelId = chat?.modelId ?? null;
  const streaming = chat?.streaming ?? false;

  const models = useModelsStore((s) => s.items);
  const loadModels = useModelsStore((s) => s.load);
  const mcp = useMcpStore((s) => s.items);
  const loadMcp = useMcpStore((s) => s.load);
  const skills = useSkillsStore((s) => s.items);
  const loadSkills = useSkillsStore((s) => s.load);
  const databases = useDatabaseStore((s) => s.items);
  const loadDatabases = useDatabaseStore((s) => s.load);
  const providers = useKnowledgeStore((s) => s.items);
  const loadProviders = useKnowledgeStore((s) => s.load);
  const rules = useRulesStore((s) => s.items);
  const loadRules = useRulesStore((s) => s.load);

  useEffect(() => {
    void loadModels();
    void loadMcp();
    void loadSkills();
    void loadDatabases();
    void loadProviders();
    void loadRules();
  }, [loadModels, loadMcp, loadSkills, loadDatabases, loadProviders, loadRules]);

  // 首次加载后默认选中 isDefault（否则首个）模型。
  useEffect(() => {
    if (modelId || models.length === 0) return;
    const preferred = models.find((m) => m.isDefault) ?? models[0];
    setModel(sessionId, preferred.id);
  }, [sessionId, modelId, models, setModel]);

  const selectedModel = models.find((m) => m.id === modelId) ?? models[0];

  const modules: {
    key: keyof ChatContext;
    icon: LucideIcon;
    label: string;
    options: Option[];
  }[] = [
    {
      key: 'dbConnectionIds',
      icon: Database,
      label: t('resDatabase'),
      options: databases
        .filter((i) => !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name })),
    },
    {
      key: 'kbProviderIds',
      icon: BookOpen,
      label: t('resKnowledge'),
      options: providers
        .filter((i) => !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name })),
    },
    {
      key: 'ruleIds',
      icon: ShieldCheck,
      label: t('resRules'),
      options: rules
        .filter((i) => i.enabled && i.sql.trim() && !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name || i.id })),
    },
    {
      key: 'mcpServerIds',
      icon: Plug,
      label: t('resMcp'),
      options: mcp
        .filter((i) => i.enabled && !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name })),
    },
    {
      key: 'skillIds',
      icon: Sparkles,
      label: t('resSkills'),
      options: skills
        .filter((i) => i.enabled && !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name })),
    },
  ];

  const onToggle = (key: keyof ChatContext, id: string) =>
    setContext(sessionId, { [key]: toggle(context[key], id) } as Partial<ChatContext>);

  const visible = modules.filter((m) => m.options.length > 0);
  const hasOptions = models.length > 0 || visible.length > 0;

  return (
    <div className="agent__context">
      {models.length > 0 && (
        <label className="ctx-model" title={t('model')}>
          <Cpu size={13} strokeWidth={1.75} />
          <select
            className="ctx-select"
            aria-label={t('model')}
            value={selectedModel?.id ?? ''}
            disabled={streaming}
            onChange={(e) => setModel(sessionId, e.target.value || null)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {visible.map((m) => (
        <ModuleMenu
          key={m.key}
          icon={m.icon}
          label={m.label}
          options={m.options}
          selected={context[m.key]}
          disabled={streaming}
          onToggle={(id) => onToggle(m.key, id)}
          onClear={() =>
            setContext(sessionId, { [m.key]: [] } as Partial<ChatContext>)
          }
        />
      ))}
      {!hasOptions && <span className="ctx-empty">{t('contextEmpty')}</span>}
    </div>
  );
}
