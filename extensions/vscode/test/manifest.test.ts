import { existsSync, readFileSync } from 'node:fs';
import { conduktorTools } from '@conduktor/core';
import { describe, expect, it } from 'vitest';
import manifest from '../package.json';

const steps = manifest.contributes.walkthroughs.flatMap((walkthrough) => walkthrough.steps);
const mediaUrl = (path: string) => new URL(`../${path}`, import.meta.url);

describe('manifest', () => {
  it('keeps connections out of workspace settings, so a repository cannot point a stored token at its own URL', () => {
    expect(manifest.contributes.configuration.properties['conduktor.connections'].scope).toBe('application');
  });

  it('declares every core agent tool exactly as core defines it (run scripts/sync-tool-manifest.mjs after changing one)', () => {
    expect(
      manifest.contributes.languageModelTools.map((t) => ({
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
    const icon = (command: string) => manifest.contributes.commands.find((c) => c.command === command)?.icon;
    expect(icon('conduktor.addConnection')).toBe('$(plug)');
    expect(icon('conduktor.newResource')).toBe('$(add)');
  });

  it('offers both diffs in the editor title, each where it means something', () => {
    const title = manifest.contributes.menus['editor/title'];
    expect(title.find((m) => m.command === 'conduktor.diffWithLive')?.when).toBe(
      'resource in conduktor.resourceDocuments',
    );
    expect(title.find((m) => m.command === 'conduktor.openChanges')?.when).toBe('resource in conduktor.modifiedFiles');
  });

  it('walks through declared commands only, so no button runs nothing and no step waits on a command that never runs', () => {
    const declared = new Set(manifest.contributes.commands.map((c) => c.command));
    const referenced = steps.flatMap((step) => [
      ...[step.description, readFileSync(mediaUrl(step.media.markdown), 'utf8')].flatMap((text) =>
        [...text.matchAll(/\]\(command:([^)?]+)/g)].map((link) => link[1]!),
      ),
      ...step.completionEvents
        .filter((event) => event.startsWith('onCommand:'))
        .map((event) => event.slice('onCommand:'.length)),
    ]);
    expect(referenced).not.toHaveLength(0);
    expect(referenced.filter((command) => !declared.has(command))).toEqual([]);
  });

  it('gives every walkthrough step a media file of its own', () => {
    const media = steps.map((step) => step.media.markdown);
    expect(media.filter((path) => !existsSync(mediaUrl(path)))).toEqual([]);
    expect(new Set(media).size).toBe(steps.length);
  });

  it('writes step descriptions without inline code, which the walkthrough shows as raw backticks', () => {
    expect(steps.filter((step) => step.description.includes('`')).map((step) => step.id)).toEqual([]);
  });
});
