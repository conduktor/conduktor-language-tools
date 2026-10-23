import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  agentInstructions,
  clientOf,
  conduktorTools,
  describeError,
  Telemetry,
  toolOf,
  type ToolContext,
} from '@conduktor/core';

// The tools carry JSON Schemas from core, which McpServer.registerTool would want as zod: they are served through
// the underlying Server, the SDK's way to set request handlers of one's own.
export function createConduktorServer(
  context: () => ToolContext | Promise<ToolContext>,
  version: string,
  telemetry: Telemetry = Telemetry.off,
): McpServer {
  const mcp = new McpServer(
    { name: 'conduktor', title: 'Conduktor Console resources', version },
    { capabilities: { tools: {} }, instructions: agentInstructions },
  );
  mcp.server.oninitialized = () => {
    const client = mcp.server.getClientVersion();
    telemetry.identify(clientOf(client?.name), client?.version);
    telemetry.track({ name: 'Started', properties: {} });
  };
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: conduktorTools.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = conduktorTools.find((t) => t.name === request.params.name);
    const called = (result: 'success' | 'failure') =>
      telemetry.track({ name: 'tool.Called', properties: { tool: toolOf(request.params.name), result } });
    if (!tool) {
      called('failure');
      return failure(`Unknown tool ${request.params.name}.`);
    }
    try {
      const text = await tool.run(request.params.arguments ?? {}, await context());
      called('success');
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      called('failure');
      return failure(describeError(error));
    }
  });
  return mcp;
}

function failure(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
