export type ConfigScope = 'global' | 'project';

export type ActivityView =
  | 'explorer'
  | 'search'
  | 'database'
  | 'knowledge'
  | 'mcp'
  | 'skills'
  | 'models'
  | 'settings';

export type ThemeMode = 'light' | 'dark';

export type SidecarStatus = 'stopped' | 'starting' | 'running' | 'failed';

export interface HealthInfo {
  status: string;
  appVersion: string;
  schemaVersion: number;
}

export interface SidecarInfo {
  port: number | null;
  token: string;
  status: SidecarStatus;
  health: HealthInfo | null;
}

export interface AppInfo {
  appVersion: string;
  platform: string;
  userData: string;
}

export interface SseEvent<T = unknown> {
  type: string;
  seq: number;
  sessionId: string;
  ts: string;
  data: T;
}

export type Severity = 'high' | 'medium' | 'low';
export type FindingStatus = 'pending' | 'in_review' | 'confirmed' | 'rejected' | 'false_positive';

export interface ScopeBadgeProps {
  scope: ConfigScope;
}

export interface FindingDataRef {
  sourceId: string;
  table: string;
  rowRef: string;
}

export interface FindingNote {
  note: { lang: string; text: string } | null;
  author?: string;
  ts?: string;
}

export interface FindingReview {
  event: string;
  status?: FindingStatus;
  severity?: Severity;
  reviewer?: string;
  comment?: string | null;
  ts?: string;
}

export interface Finding {
  id: string;
  origin: 'rule' | 'agent' | 'manual';
  ruleKey: string | null;
  title: { lang: string; text: string } | null;
  description: { lang: string; text: string } | null;
  severity: Severity;
  status: FindingStatus;
  subjects?: string[];
  amount?: string | null;
  currency?: string;
  confidence?: number | null;
  dataRefs: FindingDataRef[];
  evidenceRefs: string[];
  sessionId?: string;
  seq: number;
  ts: string;
  notes?: FindingNote[];
  reviews?: FindingReview[];
}

export interface EvidenceItem {
  seq: number;
  id: string;
  sessionId: string;
  ts: string;
  step: 'tool_call' | 'tool_result';
  tool: string | null;
  params: Record<string, unknown>;
  resultSummary: string | null;
  artifactRef: string | null;
  durationMs?: number | null;
  lang?: string;
}

export interface DataSourceRef {
  id: string;
  type: 'excel' | 'csv' | 'pdf' | 'db';
  path?: string;
  connectionId?: string;
  tables?: string[];
  importedAt?: string;
}

export interface DataSourceInfo {
  id: string;
  type: 'excel' | 'csv' | 'pdf' | 'db';
  path?: string;
  tables: string[];
  importedAt?: string;
}

export interface ImportProgressData {
  sourceId?: string;
  phase: 'parse' | 'load' | 'index';
  done: number;
  total: number;
}

export interface AuditRule {
  id: string;
  scope: 'builtin' | 'custom';
  type: 'sql' | 'prompt';
  detector?: string;
  name?: { lang: string; text: string } | null;
  nameKey?: string;
  descriptionKey?: string;
  definition?: string;
  severity: Severity;
  params?: Record<string, unknown>;
  enabled: boolean;
  builtin: boolean;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  apiKeyRef?: string | null;
  isDefault?: boolean;
  scope: ConfigScope;
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchMatch {
  line: number;
  column: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: SearchFileResult[];
  total: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
}

/** 文件树节点条目（主进程 fs:read-dir 返回）。 */
export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
}

/** 文件读取 / 写入错误码（主进程 fs:read-file / fs:write-text-file）。 */
export type FsFileErrorCode =
  | 'E_OUTSIDE_WORKSPACE'
  | 'E_NOT_FOUND'
  | 'E_UNSUPPORTED'
  | 'E_TOO_LARGE'
  | 'E_READ_FAILED'
  | 'E_NOT_EDITABLE'
  | 'E_WRITE_FAILED';

/** fs:read-file 返回：文本或 base64 内容，或错误。 */
export type FsFileContent =
  | { ok: true; kind: 'text'; text: string; size: number; path: string }
  | { ok: true; kind: 'base64'; data: string; mime: string; size: number; path: string }
  | {
      ok: false;
      code: FsFileErrorCode;
      size?: number;
      ext?: string;
      kind?: 'text' | 'base64';
    };

/** fs:write-text-file 返回。 */
export interface FsWriteResult {
  ok: boolean;
  code?: FsFileErrorCode;
  path?: string;
  size?: number;
}

export interface WorkspaceInfo {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultModelId: string | null;
  counters: Record<string, number>;
  dataSources: DataSourceRef[];
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    messageKey: string;
    params?: Record<string, unknown>;
    traceId?: string | null;
  };
}

export type GraphNodeType = 'finding' | 'dataset' | 'voucher' | 'rule' | 'tool';

export type GraphEdgeType =
  | 'derived_from'
  | 'references'
  | 'involves'
  | 'verified_by';

export interface GraphNode {
  id: string;
  nodeType: GraphNodeType;
  refId: string;
  label: string;
  meta: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: GraphEdgeType;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type WorkingPaperFormat = 'word' | 'xlsx' | 'pdf';

export interface WorkingPaperManifest {
  id: string;
  createdAt: string;
  format: WorkingPaperFormat;
  locale: string;
  templateId: string;
  findingIds: string[];
  artifactRef: string;
  files: string[];
}

export type DbDriver = 'sqlite' | 'postgresql' | 'mysql' | 'mssql' | 'access';

export interface DbConnection {
  id: string;
  name: string;
  driver: DbDriver;
  scope: ConfigScope;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  path?: string | null;
  credRef?: string;
  /** 默认自动提供给模型（无需在对话上下文栏勾选）。 */
  isDefault?: boolean;
}

export interface DbColumn {
  name: string;
  type: string;
}

export interface DbTableSchema {
  table: string;
  columns: DbColumn[];
}

export type KbProviderType = 'dify' | 'ragflow';

export interface KbProviderDefaults {
  topK?: number;
  scoreThreshold?: number;
  searchMethod?: string;
}

export interface KbProvider {
  id: string;
  type: KbProviderType;
  name: string;
  baseUrl: string;
  scope: ConfigScope;
  apiKeyRef?: string;
  defaults?: KbProviderDefaults;
  /** 默认自动提供给模型（无需在对话上下文栏勾选）。 */
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface KbKnowledge {
  id: string;
  name: string;
  documentCount?: number;
}

export interface KbEnabledEntry {
  providerId: string;
  knowledgeId: string;
  name?: string;
  scope: ConfigScope;
  enabled: boolean;
}

export type McpTransport = 'stdio' | 'sse' | 'http';

export interface McpPermissions {
  fsScope?: 'workspace' | 'none';
  net?: boolean;
  toolsAllow?: string[];
}

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  enabled: boolean;
  scope: ConfigScope;
  permissions?: McpPermissions;
  /** 默认自动提供给模型（无需在对话上下文栏勾选）。 */
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Skill {
  id: string;
  name: string;
  prompt: string;
  toolIds?: string[];
  params?: Record<string, unknown>;
  enabled: boolean;
  builtin: boolean;
  scope: ConfigScope | 'builtin';
  /** 默认自动提供给模型（无需在对话上下文栏勾选）。 */
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebSearchSettings {
  enabled: boolean;
  provider: string;
  keyRef?: string | null;
  baseUrl?: string | null;
}

export interface AppSettings {
  locale: string;
  theme: ThemeMode;
  webSearch: WebSearchSettings;
  telemetry: boolean;
}
