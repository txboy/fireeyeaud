import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Cpu, Database, Plug, Sparkles } from 'lucide-react';
import { EMPTY_CONTEXT, type ChatContext } from '../lib/api';
import { useChatStore } from '../store/chat';
import { useModelsStore } from '../store/models';
import { useMcpStore } from '../store/mcp';
import { useSkillsStore } from '../store/skills';
import { useDatabaseStore } from '../store/database';
import { useKnowledgeStore } from '../store/knowledge';

interface Option {
  id: string;
  name: string;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** 输入框上方的会话上下文栏：单选模型 + 各域非默认资源多选。 */
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

  useEffect(() => {
    void loadModels();
    void loadMcp();
    void loadSkills();
    void loadDatabases();
    void loadProviders();
  }, [loadModels, loadMcp, loadSkills, loadDatabases, loadProviders]);

  // 首次加载后默认选中 isDefault（否则首个）模型。
  useEffect(() => {
    if (modelId || models.length === 0) return;
    const preferred = models.find((m) => m.isDefault) ?? models[0];
    setModel(sessionId, preferred.id);
  }, [sessionId, modelId, models, setModel]);

  const selectedModel = models.find((m) => m.id === modelId) ?? models[0];

  const groups: { key: keyof ChatContext; icon: LucideIcon; items: Option[] }[] = [
    {
      key: 'mcpServerIds',
      icon: Plug,
      items: mcp
        .filter((i) => i.enabled && !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name })),
    },
    {
      key: 'skillIds',
      icon: Sparkles,
      items: skills
        .filter((i) => i.enabled && !i.isDefault)
        .map((i) => ({ id: i.id, name: i.name })),
    },
    {
      key: 'dbConnectionIds',
      icon: Database,
      items: databases.filter((i) => !i.isDefault).map((i) => ({ id: i.id, name: i.name })),
    },
    {
      key: 'kbProviderIds',
      icon: BookOpen,
      items: providers.filter((i) => !i.isDefault).map((i) => ({ id: i.id, name: i.name })),
    },
  ];

  const onToggle = (key: keyof ChatContext, id: string) =>
    setContext(sessionId, { [key]: toggle(context[key], id) } as Partial<ChatContext>);

  const hasOptions = models.length > 0 || groups.some((g) => g.items.length > 0);

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
      {hasOptions &&
        groups.map((g) =>
          g.items.length === 0 ? null : (
            <div key={g.key} className="ctx-group">
              <g.icon size={13} strokeWidth={1.75} className="ctx-group__icon" />
              {g.items.map((opt) => {
                const active = context[g.key].includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`ctx-chip${active ? ' ctx-chip--on' : ''}`}
                    disabled={streaming}
                    onClick={() => onToggle(g.key, opt.id)}
                  >
                    {opt.name}
                  </button>
                );
              })}
            </div>
          ),
        )}
      {!hasOptions && <span className="ctx-empty">{t('contextEmpty')}</span>}
    </div>
  );
}
