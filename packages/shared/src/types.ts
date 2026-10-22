export type ConfigScope = 'global' | 'project';

export type ActivityView =
  | 'explorer'
  | 'search'
  | 'database'
  | 'knowledge'
  | 'mcp'
  | 'skills'
  | 'rules'
  | 'models'
  | 'templates';

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
  /** 人工创建者；Agent 创建时为空。 */
  author?: string | null;
  /** 软删除标记；列表接口不会返回已删除项。 */
  deleted?: boolean;
}

export type EvidenceStep = 'tool_call' | 'tool_result' | 'manual';
export type EvidenceSource = 'agent' | 'manual';
export type EvidenceKind = 'file' | 'text' | 'record';

export interface EvidenceItem {
  seq: number;
  id: string;
  sessionId: string;
  ts: string;
  step: EvidenceStep;
  /** 证据来源；Agent 记录缺省视为 agent。 */
  source?: EvidenceSource;
  /** 人工证据的形态。 */
  kind?: EvidenceKind;
  title?: string | null;
  note?: string | null;
  /** 工作区相对路径（POSIX），仅文件证据。 */
  filePath?: string | null;
  fileHash?: string | null;
  tool: string | null;
  params: Record<string, unknown>;
  resultSummary: string | null;
  artifactRef: string | null;
  durationMs?: number | null;
  tokens?: number | null;
  lang?: string;
  prevHash?: string;
  hash?: string;
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
  /** 数据库数据源对应的连接 id（type === 'db'）。 */
  connectionId?: string;
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
  /** 默认自动提供给模型（无需在对话上下文栏勾选）。 */
  isDefault?: boolean;
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
  vision?: boolean;
  /** 上下文窗口（token）；缺省表示未知，运行时回退保守默认。 */
  contextWindow?: number | null;
  /** 单次最大输出 token；缺省表示未知。 */
  maxOutputTokens?: number | null;
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
  | {
      ok: true;
      kind: 'text';
      text: string;
      /** 探测到的文本编码（utf-8 / gb18030 / utf-16le / utf-16be）。 */
      encoding?: string;
      size: number;
      path: string;
    }
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

// ---- 取证单与项目报告（P3） ----

export interface FindingSnapshot {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  subjects: string[];
  amount: string | null;
  currency: string;
  evidence: string[];
}

export interface ReceiptInfo {
  /** 工作区相对路径（POSIX 分隔符），如 `回执单/QZ-0001_客户签收.pdf`。 */
  path: string;
  name: string;
  uploadedAt: string;
}

export interface EvidenceFormManifest {
  id: string;
  kind: 'evidence-form';
  title: string;
  templateId: string;
  /** 生成时使用的模板作用域；全局模板不随项目归档。 */
  templateScope: ConfigScope;
  templateName: string;
  createdAt: string;
  createdBy: string;
  header: Record<string, string>;
  findingIds: string[];
  findingsSnapshot: FindingSnapshot[];
  evidenceIds: string[];
  receipt: ReceiptInfo | null;
  artifactRef: string;
  /** document.docx + 原始模板快照 template.docx。 */
  files: string[];
}

export interface ReportFormSnapshot {
  id: string;
  title: string;
  createdAt: string;
  findingCount: number;
  receipt: ReceiptInfo | null;
  findings: FindingSnapshot[];
}

export interface ReportManifest {
  id: string;
  kind: 'report';
  title: string;
  templateId: string;
  templateScope: ConfigScope;
  templateName: string;
  createdAt: string;
  createdBy: string;
  header: Record<string, string>;
  formIds: string[];
  formsSnapshot: ReportFormSnapshot[];
  findingCount: number;
  artifactRef: string;
  files: string[];
}

export interface ArtifactPreview {
  token: string;
  kind: 'evidence-form' | 'report';
  fileName: string;
  /** 工作区相对路径，POSIX 分隔符。 */
  relPath: string;
  suggestedTitle: string;
  warnings: string[];
}

// ---- 项目归档（Git） ----

export interface ArchiveAuthor {
  name: string;
  email: string;
}

export interface ArchiveConfig {
  remoteUrl: string;
  username: string;
  credRef: string | null;
  autoPush: boolean;
}

export interface ArchiveManifest {
  id: string;
  createdAt: string;
  author: ArchiveAuthor;
  message: string;
  branch: string;
  counts: { findings: number; evidenceForms: number; reports: number };
  appVersion: string;
  schemaVersion: number;
  merge: null | {
    base: 'local' | 'remote';
    local: string;
    remote: string;
    choices: Array<{
      path: string;
      choice: 'local' | 'remote' | 'both' | 'auto';
    }>;
  };
}

export interface ArchiveHistoryItem {
  id: string;
  tag: string;
  commit: string;
  message: string;
  author: ArchiveAuthor;
  createdAt: string;
  manifest: ArchiveManifest | null;
  pushed: boolean;
}

export interface ArchiveStatus {
  initialized: boolean;
  branch: string;
  head: string | null;
  lastArchive: string | null;
  remote: ArchiveConfig;
  author: ArchiveAuthor;
  dirty: boolean;
  changed: string[];
  canPush: boolean;
}

export interface ArchiveConflictFile {
  path: string;
  localStatus: 'added' | 'modified' | 'deleted';
  remoteStatus: 'added' | 'modified' | 'deleted';
  autoMerge: boolean;
  hint?: string;
}

export interface ArchiveConflictCheck {
  diverged: boolean;
  behind: boolean;
  local: string | null;
  remote: string | null;
  base: string | null;
  conflicts: ArchiveConflictFile[];
  remoteOnly: string[];
  localOnly: string[];
}

export type TemplateKind = 'evidence-form' | 'report';

export interface TemplateCheck {
  tags: string[];
  loops: string[];
  unknown: string[];
  missing: string[];
  /** 有开始标记但没有结束标记的循环（P3 渲染会失败）。 */
  unclosed?: string[];
  /** unclosed 为空。 */
  balanced?: boolean;
  /** 没有 unknown 且没有 missing。 */
  ok: boolean;
}

export interface TemplateInfo {
  id: string;
  /** 与其他配置面板一致：global | project。 */
  scope: ConfigScope;
  kind: TemplateKind;
  name: string;
  fileName: string;
  /** 模板文件绝对路径；全局模板位于项目目录外。 */
  absPath: string;
  size: number;
  createdAt: string;
  updatedAt?: string;
  /** 同作用域、同 kind 内的默认模板。 */
  isDefault: boolean;
  /** 全局内置示例，不可删除，只能复制。 */
  builtin?: boolean;
  check: TemplateCheck;
}

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

/** 知识库试检索命中片段。 */
export interface KbQueryHit {
  knowledgeId: string;
  knowledgeName?: string;
  docId?: string;
  docName?: string;
  content: string;
  score?: number;
  url?: string;
}

export interface KbQueryResult {
  ok: boolean;
  elapsedMs: number;
  knowledgeCount: number;
  hits: KbQueryHit[];
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
  /** 一句话描述，用于 system prompt 广告（缺省时后端从 prompt 首行生成）。 */
  description?: string;
  /** 何时使用（可选，进一步提示模型）。 */
  whenToUse?: string;
  /** True=始终全量注入正文（lazy 模式下的逃生口）。 */
  eager?: boolean;
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
  /** 上下文压缩设置（Phase 9）。 */
  compaction?: {
    auto: boolean;
    keepTokens: number;
    reserveOutputTokens: number;
    threshold: number;
  };
  /** 技能加载模式（Phase 9 · 按需加载）。lazy=广告+load_skill，eager=全量注入。 */
  skills?: {
    mode: string;
  };
  telemetry: boolean;
}
