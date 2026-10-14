export type ConfigScope = 'global' | 'project';

export type ActivityView =
  | 'explorer'
  | 'search'
  | 'database'
  | 'knowledge'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'models';

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
  name: string;
  /** 自然语言描述：告诉模型这条 SQL 在查什么。 */
  description: string;
  /** 只读 SQL（SELECT/WITH/EXPLAIN/DESCRIBE）。 */
  sql: string;
  enabled: boolean;
  /** 默认数据库连接 id；缺省在工作区 DuckDB 上运行。 */
  databaseId?: string | null;
  /** 作用域：全局（跨工作区共享）或本项目。 */
  scope: ConfigScope;
}

/** 规则试跑结果（sql_query 的输出 + ruleId）。 */
export interface RuleRunResult {
  ruleId: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated?: boolean;
  artifactRef?: string;
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
  /** 包含范围：目录 token 以 `/` 结尾（子树），其它为精确文件相对路径；空 = 不限制。 */
  include?: string[];
  /** 排除范围：同 include 的 token 约定。 */
  exclude?: string[];
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

/** 文件删除错误码（主进程 fs:delete）。 */
export type FsDeleteErrorCode =
  | 'E_OUTSIDE_WORKSPACE'
  | 'E_NOT_FOUND'
  | 'E_DELETE_FAILED'
  | 'E_DELETE_ROOT'
  | 'E_PROTECTED';

/** 文件操作（复制 / 移动 / 新建 / 重命名）错误码。 */
export type FsOpErrorCode =
  | 'E_OUTSIDE_WORKSPACE'
  | 'E_NOT_FOUND'
  | 'E_PROTECTED'
  | 'E_INVALID_NAME'
  | 'E_EXISTS'
  | 'E_INTO_SELF'
  | 'E_ROOT'
  | 'E_OP_FAILED';

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

/** fs:delete 返回。 */
export interface FsDeleteResult {
  ok: boolean;
  code?: FsDeleteErrorCode;
  path?: string;
}

/** fs:copy-files / fs:move / fs:create-dir / fs:create-file / fs:rename 返回。 */
export interface FsOpResult {
  ok: boolean;
  code?: FsOpErrorCode;
  path?: string;
  paths?: string[];
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

export type DbDriver =
  | 'sqlite'
  | 'postgresql'
  | 'mysql'
  | 'mssql'
  | 'access'
  | 'oracle';

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
  /** Oracle：连接方式（'service' 服务名，'sid'）；其它驱动忽略。 */
  connectBy?: 'service' | 'sid' | null;
  /** 默认自动提供给模型（无需在对话上下文栏勾选）。 */
  isDefault?: boolean;
}

export interface DbColumn {
  name: string;
  type: string;
  comment?: string | null;
  nullable?: boolean;
  primaryKey?: boolean;
}

export interface DbTableSchema {
  table: string;
  comment?: string | null;
  columns: DbColumn[];
}

/** 表数据预览的一次分页查询结果。total 为 null 表示未统计（COUNT 失败或未请求）。 */
export interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  total: number | null;
  hasMore: boolean;
  /** 是否可分页；用户 SQL 自带 LIMIT 或 EXPLAIN/DESCRIBE 时为 false。 */
  paginated: boolean;
  limit: number;
  offset: number;
  /** 实际执行的完整 SQL（含分页包装）。 */
  sql: string;
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
  /** 明文环境变量（stdio 传给子进程；敏感值请改用 apiKeyRef）。 */
  env?: Record<string, string> | null;
  url?: string | null;
  /** 远程鉴权（sse/http 作为 Authorization: Bearer）或 stdio 注入用的密钥引用。 */
  apiKeyRef?: string | null;
  /** 若设置，stdio 启动时把密钥注入为该环境变量名。 */
  apiKeyEnv?: string | null;
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
  scope: ConfigScope;
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
  systemPrompt: string;
  webSearch: WebSearchSettings;
  telemetry: boolean;
}
