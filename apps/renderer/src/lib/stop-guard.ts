import i18n from '../i18n';
import { useChatStore } from '../store/chat';
import { useConfirmStore } from '../store/confirm';

function promptStop(): Promise<boolean> {
  return useConfirmStore.getState().confirm({
    title: i18n.t('stopStreamingTitle', { ns: 'agent' }),
    message: i18n.t('stopStreamingConfirm', { ns: 'agent' }),
    confirmLabel: i18n.t('confirm', { ns: 'common' }),
    cancelLabel: i18n.t('cancel', { ns: 'common' }),
    danger: true,
  });
}

/**
 * 关闭/删除某个会话前，若它正在生成则先警告用户；确认后中止其生成。
 * 返回 true 表示可以继续（本来没生成，或用户确认停止）。
 */
export async function confirmStopSession(sessionId: string): Promise<boolean> {
  if (!useChatStore.getState().chats[sessionId]?.streaming) return true;
  const ok = await promptStop();
  if (ok) useChatStore.getState().abortSession(sessionId);
  return ok;
}

/**
 * 切换/关闭工作区前，若有会话正在生成则先警告用户；确认后中止全部生成。
 * 返回 true 表示可以继续。
 */
export async function confirmStopAll(): Promise<boolean> {
  if (!useChatStore.getState().hasStreaming()) return true;
  const ok = await promptStop();
  if (ok) useChatStore.getState().abortAll();
  return ok;
}
