import { readFileSync } from 'node:fs';
import { conduktorTools } from '@conduktor/vscode-core';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('keeps connections out of workspace settings, so a repository cannot point a stored token at its own URL', () => {
    expect(manifest.contributes.configuration.properties['conduktor.connections'].scope).toBe('application');
  });

  it('declares every core agent tool exactly as core defines it (run scripts/sync-tool-manifest.mjs after changing one)', () => {
    const declared = manifest.contributes.languageModelTools ?? [];
    expect(
      declared.map((t: Record<string, unknown>) => ({
        name: t.name,
        title: t.displayName,
        description: t.modelDescription,
        inputSchema: t.inputSchema,
      })),
    ).toEqual(
      conduktorTools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })),
    );
  });

  it('needs the VS Code version that has the MCP server provider API', () => {
    expect(manifest.engines.vscode).toBe('^1.101.0');
  });

  it('gives Add Connection its own icon, not a second plus beside New Resource', () => {
    const icon = (command: string) =>
      manifest.contributes.commands.find((c: { command: string }) => c.command === command)?.icon;
    expect(icon('conduktor.addConnection')).toBe('$(plug)');
    expect(icon('conduktor.newResource')).toBe('$(add)');
  });

  it('offers both diffs in the editor title, each where it means something', () => {
    const title = manifest.contributes.menus['editor/title'] as { command: string; when: string }[];
    expect(title.find((m) => m.command === 'conduktor.diffWithLive')?.when).toBe(
      'resource in conduktor.resourceDocuments',
    );
    expect(title.find((m) => m.command === 'conduktor.openChanges')?.when).toBe('resource in conduktor.modifiedFiles');
  });
});
