import type { ConsoleClient } from '../client/consoleClient';
import type { ConnectionMode } from '../connectionMode';
import type { KindCatalog } from '../openapi/kindCatalog';
import type { JsonSchema } from '../openapi/types';

export interface ToolContext {
  connectionName: string;
  mode: ConnectionMode;
  catalog: KindCatalog;
  schema: JsonSchema;
  client: Pick<ConsoleClient, 'list' | 'get' | 'upsert'>;
  readFile?: (path: string) => string;
  readInclude?: (path: string) => string;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: 'object' };
  run(input: Record<string, unknown>, context: ToolContext): Promise<string>;
}

// An error the agent can act on; its message is returned to the model as is.
export class ToolError extends Error {
  override name = 'ToolError';
}
