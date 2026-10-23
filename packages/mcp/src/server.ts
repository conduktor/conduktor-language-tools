import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { agentInstructions, conduktorTools, describeError, type ToolContext } from '@conduktor/core';
import { PROMPTS } from './prompts';

// The tools carry JSON Schemas from core, which McpServer.registerTool would want as zod: they are served through
// the underlying Server, the SDK's way to set request handlers of one's own.
export function createConduktorServer(context: () => ToolContext | Promise<ToolContext>, version: string): McpServer {
  const mcp = new McpServer(
    { name: 'conduktor', title: 'Conduktor Console resources', version },
    { capabilities: { tools: {}, prompts: {} }, instructions: agentInstructions },
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
  mcp.server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({
      name,
      title,
      description,
      arguments: args,
    })),
  }));
  mcp.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const prompt = PROMPTS.find((p) => p.name === request.params.name);
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt ${request.params.name}.`);
    const args = request.params.arguments ?? {};
    const missing = prompt.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
    if (missing.length > 0) throw new McpError(ErrorCode.InvalidParams, `${prompt.name} needs ${missing.join(', ')}.`);
    return {
      description: prompt.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.text(args) } }],
    };
  });
  return mcp;
}

function failure(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
