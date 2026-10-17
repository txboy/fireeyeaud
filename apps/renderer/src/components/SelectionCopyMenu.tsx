import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '../lib/clipboard';
import { ContextMenu } from './ContextMenu';

interface MenuState {
  x: number;
  y: number;
  text: string;
}

/**
 * 全局右键「复制」菜单：当页面存在文本选区时，右键在被选中文本处弹出「复制」。
 * 若已有组件（如文件树）在自己的 onContextMenu 中 preventDefault，则让位不重复弹出。
 */
export function SelectionCopyMenu() {
  const { t } = useTranslation('common');
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const text = window.getSelection()?.toString().trim() ?? '';
      if (!text) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, text });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  if (!menu) return null;

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={[
        {
          key: 'copy',
          label: t('copy'),
          onSelect: () => void copyText(menu.text),
        },
      ]}
      onClose={() => setMenu(null)}
    />
  );
}
