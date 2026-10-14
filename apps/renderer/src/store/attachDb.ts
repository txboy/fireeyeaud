import { create } from 'zustand';
import type { ConfigScope } from '@fireeyeaud/shared';

export interface AttachDbOptions {
  title: string;
  message: string;
  scopeLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  defaultScope: ConfigScope;
}

export interface AttachDbResult {
  scope: ConfigScope;
}

interface AttachDbState {
  open: boolean;
  options: AttachDbOptions | null;
  resolve: ((value: AttachDbResult | null) => void) | null;
  /** 打开「附加数据库」弹窗，返回用户选择的作用域（取消为 null）。 */
  promptAttach: (options: AttachDbOptions) => Promise<AttachDbResult | null>;
  respond: (value: AttachDbResult | null) => void;
}

/**
 * 全局「附加数据库」弹窗（弹出层）。命令式调用：
 * `const res = await useAttachDbStore.getState().promptAttach({...})`。
 */
export const useAttachDbStore = create<AttachDbState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,

  promptAttach: (options) =>
    new Promise<AttachDbResult | null>((resolve) => {
      set({ open: true, options, resolve });
    }),

  respond: (value) => {
    get().resolve?.(value);
    set({ open: false, options: null, resolve: null });
  },
}));
