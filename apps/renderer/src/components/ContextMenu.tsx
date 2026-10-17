import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** 与视口边缘的安全间距。 */
const VIEWPORT_MARGIN = 8;

/** 应用内右键菜单（弹出层，跟随光标定位，并自动收敛到视口内）。 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  // 挂载后（绘制前）测量实际尺寸并收敛坐标：靠近底部/右侧时菜单不会被裁到视口外。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    if (left + width + VIEWPORT_MARGIN > vw) left = vw - width - VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    let top = y;
    if (top + height + VIEWPORT_MARGIN > vh) {
      // 下方空间不足：上方够高则翻到光标上方，否则贴下边收敛。
      if (y - height - VIEWPORT_MARGIN >= VIEWPORT_MARGIN) {
        top = y - height;
      } else {
        top = vh - height - VIEWPORT_MARGIN;
        if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
      }
    }

    setPos({ top, left });
  }, [x, y, items]);

  useEffect(() => {
    const onDocDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ctxmenu" style={{ top: pos.top, left: pos.left }} role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`ctxmenu__item${item.danger ? ' ctxmenu__item--danger' : ''}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
