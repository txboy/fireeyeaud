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
