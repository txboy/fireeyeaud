import { create } from 'zustand';

export interface PromptOptions {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
}

interface PromptState {
  open: boolean;
  options: PromptOptions | null;
  resolve: ((value: string | null) => void) | null;
  /** 打开输入弹窗，返回用户输入（取消为 null）。 */
  prompt: (options: PromptOptions) => Promise<string | null>;
  respond: (value: string | null) => void;
}

/**
 * 全局输入弹窗（弹出层）。命令式调用：
 * `const name = await usePromptStore.getState().prompt({...})`。
 */
export const usePromptStore = create<PromptState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,

  prompt: (options) =>
    new Promise<string | null>((resolve) => {
      set({ open: true, options, resolve });
    }),

  respond: (value) => {
    get().resolve?.(value);
    set({ open: false, options: null, resolve: null });
  },
}));
