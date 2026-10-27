/** MCP Server：CRUD、工具发现。 */

import type { ConfigScope, McpServer, McpTransport } from '@fireeyeaud/shared';
import { request } from './client';

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

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface McpTestResult {
  ok: boolean;
  tools: McpToolInfo[];
  error?: string;
}

/** 连接测试：连接 Server 并返回 tools/list（失败时 ok=false + error）。 */
export function testMcpServer(id: string): Promise<McpTestResult> {
  return request<McpTestResult>(`/mcp/servers/${id}/test`, { method: 'POST' });
}

/** 工具预览（后端短 TTL 缓存）。 */
export function getMcpServerTools(
  id: string,
): Promise<{ tools: McpToolInfo[]; error?: string }> {
  return request<{ tools: McpToolInfo[]; error?: string }>(`/mcp/servers/${id}/tools`);
}
