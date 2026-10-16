import { describe, expect, it } from 'vitest';
import { claudeCodeConfig } from '../src/agents/claudeCodeConfig';

describe('claudeCodeConfig', () => {
  const config = claudeCodeConfig({
    url: 'http://localhost:8080',
    name: 'local',
    serverPath: '/storage/mcp/mcp-server.js',
  });

  it('runs the bundled server with node and the connection in its environment', () => {
    expect(config.mcpServers.conduktor).toEqual({
      command: 'node',
      args: ['/storage/mcp/mcp-server.js'],
      env: {
        CONDUKTOR_URL: 'http://localhost:8080',
        CONDUKTOR_NAME: 'local',
        CONDUKTOR_TOKEN: '${CONDUKTOR_TOKEN}',
      },
    });
  });

  it("adds the Console's own MCP server over HTTP", () => {
    expect(config.mcpServers['conduktor-console']).toEqual({
      type: 'http',
      url: 'http://localhost:8080/api/mcp',
      headers: { Authorization: 'Bearer ${CONDUKTOR_TOKEN}' },
    });
  });

  it('only ever refers to the token through an environment variable', () => {
    expect(JSON.stringify(config).match(/\$\{CONDUKTOR_TOKEN\}/g)).toHaveLength(2);
  });
});
