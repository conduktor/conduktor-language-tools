import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { agentInstructions, conduktorTools, describeError, type ToolContext } from '@conduktor/core';

// The tools carry JSON Schemas from core, which McpServer.registerTool would want as zod: they are served through
// the underlying Server, the SDK's way to set request handlers of one's own.
export function createConduktorServer(context: () => ToolContext | Promise<ToolContext>, version: string): McpServer {
  const mcp = new McpServer(
    { name: 'conduktor', title: 'Conduktor Console resources', version },
    { capabilities: { tools: {} }, instructions: agentInstructions },
  );
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
    if (!tool) return failure(`Unknown tool ${request.params.name}.`);
    try {
      const text = await tool.run(request.params.arguments ?? {}, await context());
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return failure(describeError(error));
    }
  });
  return mcp;
}

function failure(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
