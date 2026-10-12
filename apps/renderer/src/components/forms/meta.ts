import type { LucideIcon } from 'lucide-react';
import { BookOpen, Cpu, Database, Plug, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FormDomain, FormTab } from '../../store/ui';

/** 各配置域在 tab 上的图标。 */
export const FORM_DOMAIN_ICON: Record<FormDomain, LucideIcon> = {
  database: Database,
  knowledge: BookOpen,
  mcp: Plug,
  skills: Sparkles,
  models: Cpu,
};

/** 返回一个根据表单 tab 计算标题的函数（随语言切换刷新）。 */
export function useFormTitle(): (tab: FormTab) => string {
  const { t: tc } = useTranslation('common');
  const { t: tdb } = useTranslation('database');
  const { t: tkb } = useTranslation('knowledge');
  const { t: tmcp } = useTranslation('mcp');
  const { t: tsk } = useTranslation('skills');
  const { t: tmd } = useTranslation('models');

  return (tab: FormTab) => {
    if (tab.mode === 'edit') {
      const edit = tc('edit');
      return tab.name ? `${edit} · ${tab.name}` : edit;
    }
    switch (tab.domain) {
      case 'database':
        return tdb('addConnection');
      case 'knowledge':
        return tkb('newConnection');
      case 'mcp':
        return tmcp('addServer');
      case 'skills':
        return tsk('addSkill');
      case 'models':
        return tmd('addModel');
    }
  };
}
