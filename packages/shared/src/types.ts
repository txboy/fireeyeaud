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

export interface DataSourceRef {
  id: string;
  type: 'excel' | 'csv' | 'pdf' | 'db';
  path?: string;
  connectionId?: string;
  tables?: string[];
  importedAt?: string;
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
