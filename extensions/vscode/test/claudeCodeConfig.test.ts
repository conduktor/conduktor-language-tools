import { describe, expect, it } from 'vitest';
import { claudeCodeConfig } from '../src/agents/claudeCodeConfig';

describe('claudeCodeConfig', () => {
  it("runs the bundled server with node, adds the Console's own MCP server over HTTP, and names the token only as ${CONDUKTOR_TOKEN}", () => {
    expect(
      claudeCodeConfig({ url: 'http://localhost:8080', name: 'local', serverPath: '/storage/mcp/mcp-server.js' }),
    ).toEqual({
      mcpServers: {
        conduktor: {
          command: 'node',
          args: ['/storage/mcp/mcp-server.js'],
          env: {
            CONDUKTOR_URL: 'http://localhost:8080',
            CONDUKTOR_NAME: 'local',
            CONDUKTOR_TOKEN: '${CONDUKTOR_TOKEN}',
          },
        },
        'conduktor-console': {
          type: 'http',
          url: 'http://localhost:8080/api/mcp',
          headers: { Authorization: 'Bearer ${CONDUKTOR_TOKEN}' },
        },
      },
    });
  });
});
