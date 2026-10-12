import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** 主按钮是否为危险样式（删除等破坏性操作）。 */
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
  /** 打开确认弹窗，返回用户是否确认。 */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  respond: (ok: boolean) => void;
}

/**
 * 全局确认弹窗（弹出层）。用命令式调用：
 * `const ok = await useConfirmStore.getState().confirm({...})`。
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({ open: true, options, resolve });
    }),

  respond: (ok) => {
    get().resolve?.(ok);
    set({ open: false, options: null, resolve: null });
  },
}));
