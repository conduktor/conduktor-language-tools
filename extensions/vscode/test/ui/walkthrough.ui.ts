import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeConsole, type FakeConsole } from './fakeConsole';
import { Workbench } from './workbench';

const extension = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', extension), 'utf8')) as {
  contributes: { walkthroughs: { steps: { id: string; title: string; media: { markdown: string } }[] }[] };
};
const steps = manifest.contributes.walkthroughs[0]!.steps.map((step) => ({
  ...step,
  heading: /^## (.+)$/m.exec(readFileSync(new URL(step.media.markdown, extension), 'utf8'))?.[1],
}));

// A step checks off a moment after its command, and each look at the walkthrough brings it back first.
const SOON = { timeout: 20_000, interval: 250 };

describe('the Get Started walkthrough', () => {
  let console: FakeConsole;
  let vscode: Workbench;
  beforeAll(async () => {
    console = await fakeConsole(fileURLToPath(new URL('dist/public-api-doc.yaml', extension)));
  });
  beforeEach(async () => {
    vscode = await Workbench.open();
  }, 300_000);
  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail') await vscode.screenshot(task.name);
    await vscode.close();
  });
  afterAll(() => console.close());

  const done = async () => {
    await vscode.walkthrough();
    return (await vscode.steps()).filter((step) => step.done).map((step) => step.id);
  };
  const connect = async () => {
    await vscode.button('connect');
    await vscode.answer('Conduktor Console URL', console.url);
    await vscode.answer('Personal access token', 'secret');
    await vscode.answer('Connection name', 'fake');
    // Focus goes back to the walkthrough between prompts: this pick has to stay open for it.
    await vscode.answer('What may this connection change?', 'Prod');
    await expect.poll(done, SOON).toEqual(['connect']);
  };

  it('shows every step with its page beside it', async () => {
    await vscode.walkthrough();
    expect((await vscode.steps()).map(({ id, title }) => ({ id, title }))).toEqual(
      steps.map(({ id, title }) => ({ id, title })),
    );
    for (const { id, heading } of steps) expect(await vscode.stepPage(id, heading!)).toBe(heading);
  });

  it('takes a new user from a first connection to a first apply, step by step, through its buttons', async () => {
    await connect();

    await vscode.button('explore');
    await vscode.answer('Which cluster on fake?', 'local-kafka');
    await expect.poll(done, SOON).toEqual(['connect', 'explore']);

    await vscode.button('write');
    await vscode.answer('New Conduktor resource', 'Topic');
    await vscode.dismiss('Where should Conduktor keep its repository?');
    await expect.poll(done, SOON).toContain('write');

    await vscode.focusEditor('Untitled');
    await vscode.command('Conduktor: Dry Run File');
    await expect.poll(done, SOON).toContain('check');

    await vscode.button('apply');
    await vscode.answer('What may fake change?', 'Dev');
    await vscode.focusEditor('Untitled');
    await vscode.command('Conduktor: Apply File');
    expect(await vscode.confirm('Apply')).toMatch(/Apply to fake\?[\s\S]*1 Created/);
    await expect.poll(() => console.applied, SOON).toContain('local-kafka/topic/my-topic');

    await vscode.button('agents');
    await expect.poll(done, SOON).toEqual(['connect', 'explore', 'write', 'check', 'apply', 'agents']);
  });

  it("asks for a new resource's cluster when none is picked yet, and keeps that pick open", async () => {
    await connect();
    await vscode.button('write');
    await vscode.answer('New Conduktor resource', 'Topic');
    await vscode.answer('New Topic: which cluster?', 'other-kafka');
    await vscode.dismiss('Where should Conduktor keep its repository?');
    await expect.poll(() => vscode.editorText(), SOON).toContain('cluster: other-kafka');
  });
});
