import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { agentInstructions, conduktorTools, describeError, type ToolContext } from '@conduktor/core';

export function createConduktorServer(context: () => ToolContext | Promise<ToolContext>, version: string): Server {
  const server = new Server(
    { name: 'conduktor', title: 'Conduktor Console resources', version },
    { capabilities: { tools: {} }, instructions: agentInstructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: conduktorTools.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = conduktorTools.find((t) => t.name === request.params.name);
    if (!tool) return failure(`Unknown tool ${request.params.name}.`);
    try {
      const text = await tool.run(request.params.arguments ?? {}, await context());
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      return failure(describeError(error));
    }
  });
  return server;
}

function failure(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
