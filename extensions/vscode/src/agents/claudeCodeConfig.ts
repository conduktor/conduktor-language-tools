const TOKEN = '${CONDUKTOR_TOKEN}';

export interface ClaudeCodeConnection {
  url: string;
  name: string;
  serverPath: string;
}

// Claude Code expands ${VAR} in .mcp.json, so the token stays in the user's environment.
export function claudeCodeConfig(connection: ClaudeCodeConnection) {
  return {
    mcpServers: {
      conduktor: {
        command: 'node',
        args: [connection.serverPath],
        env: {
          CONDUKTOR_URL: connection.url,
          CONDUKTOR_NAME: connection.name,
          CONDUKTOR_TOKEN: TOKEN,
        },
      },
      'conduktor-console': {
        type: 'http',
        url: `${connection.url}/api/mcp`,
        headers: { Authorization: `Bearer ${TOKEN}` },
      },
    },
  };
}
