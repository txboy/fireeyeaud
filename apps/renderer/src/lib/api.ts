import type {
  ApiErrorEnvelope,
  AppSettings,
  AuditRule,
  ConfigScope,
  DataSourceInfo,
  DbConnection,
  DbDriver,
  DbTableSchema,
  EvidenceItem,
  Finding,
  GraphData,
  KbEnabledEntry,
  KbKnowledge,
  KbProvider,
  KbProviderDefaults,
  KbProviderType,
  McpServer,
  McpTransport,
  ModelProfile,
  Skill,
  SseEvent,
  WorkingPaperFormat,
  WorkingPaperManifest,
  WorkspaceInfo,
} from '@fireeyeaud/shared';
import { useSidecarStore } from '../store/sidecar';

export class ApiError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    public messageKey: string,
    public params: Record<string, unknown> = {},
  ) {
    super(messageKey);
    this.name = 'ApiError';
  }
}

function baseUrl(): string {
  const info = useSidecarStore.getState().info;
  if (!info || !info.port) {
    throw new ApiError('E_SIDECAR_NOT_READY', 503, 'error.sidecarNotReady');
  }
  return `http://127.0.0.1:${info.port}/api/v1`;
}

function authHeaders(): Record<string, string> {
  const info = useSidecarStore.getState().info;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (info?.token) headers.Authorization = `Bearer ${info.token}`;
  return headers;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const env = (await res.json()) as ApiErrorEnvelope;
    if (env?.error) {
      return new ApiError(
        env.error.code,
        res.status,
        env.error.messageKey,
        env.error.params ?? {},
      );
    }
  } catch {
    /* 非 JSON 响应 */
  }
  return new ApiError('E_INTERNAL', res.status, 'error.internal');
}

/**
 * fetch 包装：把网络层异常（连接被拒 / 超时等）统一为 ApiError，
 * 避免上层拿到缺少 messageKey 的原始错误。
 */
async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('E_NETWORK', 0, 'error.internal');
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await safeFetch(baseUrl() + path, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export function openWorkspaceApi(path: string): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/workspaces/open', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function closeWorkspaceApi(): Promise<{ closed: boolean }> {
  return request<{ closed: boolean }>('/workspaces/close', { method: 'POST' });
}

export interface SessionInfo {
  id: string;
  title: string | null;
  createdAt: string;
}

export function createSessionApi(input: {
  title?: string | null;
  dataSourceIds?: string[];
}): Promise<SessionInfo> {
  return request<SessionInfo>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt?: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  content: { text?: string } | string | null;
  ts: string;
}

export function listSessionsApi(): Promise<{ items: SessionSummary[] }> {
  return request<{ items: SessionSummary[] }>('/sessions');
}

export function getSessionMessagesApi(id: string): Promise<{ items: SessionMessage[] }> {
  return request<{ items: SessionMessage[] }>(`/sessions/${id}/messages`);
}

export function deleteSessionApi(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' });
}

export function renameSessionApi(id: string, title: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export interface ChatHandlers {
  onEvent: (event: SseEvent) => void;
  signal?: AbortSignal;
}

/** 消费 POST 返回的 SSE 流并逐条回调事件。 */
async function consumeSse(
  res: Response,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as SseEvent);
      } catch {
        /* 忽略无法解析的行 */
      }
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      dispatch(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

/** 对话上下文：本次会话勾选的非默认资源（后端再并上默认集）。 */
export interface ChatContext {
  skillIds: string[];
  kbProviderIds: string[];
  dbConnectionIds: string[];
  mcpServerIds: string[];
}

/** 临时附件（不写工作区，仅随消息提供给模型参考）。 */
export interface AttachmentRef {
  path: string;
  name: string;
  size?: number;
}

export const EMPTY_CONTEXT: ChatContext = {
  skillIds: [],
  kbProviderIds: [],
  dbConnectionIds: [],
  mcpServerIds: [],
};

/** 发送一条消息并逐条回调 SSE 事件（POST + ReadableStream 解析）。 */
export async function streamChat(
  sessionId: string,
  message: string,
  { onEvent, signal }: ChatHandlers,
  locale?: string,
  modelId?: string,
  context?: ChatContext,
  attachments?: AttachmentRef[],
): Promise<void> {
  const res = await safeFetch(`${baseUrl()}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ message, locale, modelId, context, attachments }),
    signal,
  });
  await consumeSse(res, onEvent);
}

export interface DatasourcesPage {
  items: DataSourceInfo[];
  nextCursor: string | null;
}

export function listDatasources(): Promise<DatasourcesPage> {
  return request<DatasourcesPage>('/datasources');
}

/** 删除已导入的数据源（DuckDB 表 + 登记记录，不动磁盘原文件）。 */
export function deleteDataSource(id: string): Promise<{ ok: boolean; sourceId: string }> {
  return request(`/datasources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 导入单个数据文件并回调 SSE 进度事件。 */
export async function importDataSource(
  path: string,
  { onEvent, signal }: ChatHandlers,
): Promise<void> {
  const res = await safeFetch(`${baseUrl()}/datasources/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path }),
    signal,
  });
  await consumeSse(res, onEvent);
}

export interface FindingsPage {
  items: Finding[];
  nextCursor: string | null;
}

export function listFindings(params?: {
  severity?: string;
  status?: string;
  limit?: number;
}): Promise<FindingsPage> {
  const query = new URLSearchParams();
  if (params?.severity) query.set('severity', params.severity);
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return request<FindingsPage>(`/findings${qs ? `?${qs}` : ''}`);
}

export function getFindingApi(id: string): Promise<Finding> {
  return request<Finding>(`/findings/${id}`);
}

export interface ReviewInput {
  action: string;
  reviewer?: string;
  comment?: string;
  note?: string;
  severity?: string;
  reason?: string;
}

export function reviewFindingApi(id: string, body: ReviewInput): Promise<unknown> {
  return request(`/findings/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listEvidence(findingId?: string): Promise<{ items: EvidenceItem[] }> {
  const qs = findingId ? `?findingId=${encodeURIComponent(findingId)}` : '';
  return request<{ items: EvidenceItem[] }>(`/evidence${qs}`);
}

export function getGraph(findingId?: string): Promise<GraphData> {
  const qs = findingId ? `?findingId=${encodeURIComponent(findingId)}` : '';
  return request<GraphData>(`/graph${qs}`);
}

export function listWorkingPapers(): Promise<{ items: WorkingPaperManifest[] }> {
  return request<{ items: WorkingPaperManifest[] }>('/export/working-paper');
}

export interface ExportInput {
  format: WorkingPaperFormat;
  locale?: string;
  findingIds?: string[];
}

export function exportWorkingPaper(input: ExportInput): Promise<WorkingPaperManifest> {
  return request<WorkingPaperManifest>('/export/working-paper', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface RulesPage {
  items: AuditRule[];
  nextCursor: string | null;
}

export function listRules(): Promise<RulesPage> {
  return request<RulesPage>('/rules');
}

export interface RuleInput {
  name?: string;
  type?: 'sql' | 'prompt';
  definition?: string;
  severity?: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
}

export function createRule(input: RuleInput): Promise<AuditRule> {
  return request<AuditRule>('/rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRuleApi(id: string, patch: RuleInput): Promise<AuditRule> {
  return request<AuditRule>(`/rules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteRuleApi(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/rules/${id}`, { method: 'DELETE' });
}

export function runRuleApi(id: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/rules/${id}/run`, { method: 'POST' });
}

export function runAllRulesApi(): Promise<{ created: string[]; count: number }> {
  return request<{ created: string[]; count: number }>('/rules/run', {
    method: 'POST',
  });
}

export interface ModelsPage {
  items: ModelProfile[];
  nextCursor: string | null;
}

export function listModels(scope?: ConfigScope): Promise<ModelsPage> {
  return request<ModelsPage>(`/models${scope ? `?scope=${scope}` : ''}`);
}

export interface ModelInput {
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  apiKeyRef?: string | null;
  isDefault?: boolean;
  scope: ConfigScope;
}

export function createModel(input: ModelInput): Promise<ModelProfile> {
  return request<ModelProfile>('/models', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateModel(
  id: string,
  scope: ConfigScope,
  patch: Partial<ModelInput>,
): Promise<ModelProfile> {
  return request<ModelProfile>(`/models/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteModelApi(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/models/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function testModel(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/models/${id}/test?scope=${scope}`, {
    method: 'POST',
  });
}

export interface DbConnectionsPage {
  items: DbConnection[];
  nextCursor: string | null;
}

export function listDbConnections(scope?: ConfigScope): Promise<DbConnectionsPage> {
  return request<DbConnectionsPage>(`/db/connections${scope ? `?scope=${scope}` : ''}`);
}

export interface DbConnectionInput {
  name: string;
  driver: DbDriver;
  scope: ConfigScope;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  credRef?: string | null;
  path?: string | null;
  isDefault?: boolean;
}

export function createDbConnection(input: DbConnectionInput): Promise<DbConnection> {
  return request<DbConnection>('/db/connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDbConnection(
  id: string,
  scope: ConfigScope,
  patch: Partial<DbConnectionInput>,
): Promise<DbConnection> {
  return request<DbConnection>(`/db/connections/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteDbConnection(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/db/connections/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function testDbConnection(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/db/connections/${id}/test?scope=${scope}`, {
    method: 'POST',
  });
}

export interface ReflectResult {
  sourceId: string;
  tables: string[];
  schema: DbTableSchema[];
  authorization: Record<string, string[]>;
}

export function reflectDbConnection(
  id: string,
  scope: ConfigScope,
): Promise<ReflectResult> {
  return request<ReflectResult>(`/db/connections/${id}/reflect?scope=${scope}`, {
    method: 'POST',
  });
}

export function setDbAuthorization(
  id: string,
  tables: Record<string, string[]>,
): Promise<{ ok: boolean; tables: Record<string, string[]> }> {
  return request<{ ok: boolean; tables: Record<string, string[]> }>(
    `/db/connections/${id}/authorization`,
    { method: 'PATCH', body: JSON.stringify({ tables }) },
  );
}

export interface KbProvidersPage {
  items: KbProvider[];
  nextCursor: string | null;
}

export function listKbProviders(scope?: ConfigScope): Promise<KbProvidersPage> {
  return request<KbProvidersPage>(`/kb/providers${scope ? `?scope=${scope}` : ''}`);
}

export interface KbProviderInput {
  type: KbProviderType;
  name: string;
  baseUrl: string;
  scope: ConfigScope;
  apiKeyRef?: string | null;
  defaults?: KbProviderDefaults;
  isDefault?: boolean;
}

export function createKbProvider(input: KbProviderInput): Promise<KbProvider> {
  return request<KbProvider>('/kb/providers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateKbProvider(
  id: string,
  scope: ConfigScope,
  patch: Partial<KbProviderInput>,
): Promise<KbProvider> {
  return request<KbProvider>(`/kb/providers/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteKbProvider(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/kb/providers/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function testKbProvider(
  id: string,
  scope: ConfigScope,
): Promise<{ ok: boolean; knowledgeCount: number }> {
  return request(`/kb/providers/${id}/test?scope=${scope}`, { method: 'POST' });
}

export function listKbKnowledge(
  id: string,
  scope: ConfigScope,
): Promise<{ items: KbKnowledge[] }> {
  return request(`/kb/providers/${id}/knowledge?scope=${scope}`);
}

export function listKbEnabled(scope?: ConfigScope): Promise<{ items: KbEnabledEntry[] }> {
  return request(`/kb/enabled${scope ? `?scope=${scope}` : ''}`);
}

export function setKbEnabled(
  scope: ConfigScope,
  items: KbEnabledEntry[],
): Promise<{ ok: boolean; items: KbEnabledEntry[] }> {
  return request('/kb/enabled', {
    method: 'PATCH',
    body: JSON.stringify({ scope, items }),
  });
}

export interface McpServersPage {
  items: McpServer[];
  nextCursor: string | null;
}

export function listMcpServers(scope?: ConfigScope): Promise<McpServersPage> {
  return request<McpServersPage>(`/mcp/servers${scope ? `?scope=${scope}` : ''}`);
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  apiKeyRef?: string | null;
  apiKeyEnv?: string | null;
  enabled?: boolean;
  scope: ConfigScope;
  permissions?: {
    fsScope?: 'workspace' | 'none';
    net?: boolean;
    toolsAllow?: string[];
  };
  isDefault?: boolean;
}

export function createMcpServer(input: McpServerInput): Promise<McpServer> {
  return request<McpServer>('/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateMcpServer(
  id: string,
  scope: ConfigScope,
  patch: Partial<McpServerInput>,
): Promise<McpServer> {
  return request<McpServer>(`/mcp/servers/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteMcpServer(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/mcp/servers/${id}?scope=${scope}`, {
    method: 'DELETE',
  });
}

export function listSkills(): Promise<{ items: Skill[] }> {
  return request<{ items: Skill[] }>('/skills');
}

export interface SkillInput {
  name: string;
  prompt: string;
  toolIds?: string[];
  params?: Record<string, unknown>;
  enabled?: boolean;
  scope: ConfigScope;
  isDefault?: boolean;
}

export function createSkill(input: SkillInput): Promise<Skill> {
  return request<Skill>('/skills', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSkill(
  id: string,
  scope: ConfigScope,
  patch: Partial<SkillInput>,
): Promise<Skill> {
  return request<Skill>(`/skills/${id}?scope=${scope}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteSkill(id: string, scope: ConfigScope): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/skills/${id}?scope=${scope}`, { method: 'DELETE' });
}

export function getSettings(): Promise<AppSettings> {
  return request<AppSettings>('/settings');
}

export interface SettingsPatch {
  locale?: string;
  theme?: string;
  systemPrompt?: string;
  webSearch?: {
    enabled?: boolean;
    provider?: string;
    keyRef?: string | null;
    baseUrl?: string | null;
  };
}

export function patchSettings(patch: SettingsPatch): Promise<AppSettings> {
  return request<AppSettings>('/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
