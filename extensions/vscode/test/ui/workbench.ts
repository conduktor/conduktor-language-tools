import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

const extension = fileURLToPath(new URL('../..', import.meta.url));
const WALKTHROUGH = 'Get Started with Conduktor Console';
// How long a person looks at a prompt before answering it.
const READING_MS = 1_000;

/**
 * The VS Code window, driven as a user would: the palette, the prompts, the walkthrough's buttons. For what the
 * extension host cannot see, such as the walkthrough page and whether a prompt stays open.
 */
export class Workbench {
  private constructor(
    private readonly app: ElectronApplication,
    readonly page: Page,
  ) {}

  /**
   * VS Code with the built extension and no other, in a fresh profile and an empty folder; or with another build of
   * it, and more in its environment.
   */
  static async open(options: { extension?: string; env?: Record<string, string> } = {}): Promise<Workbench> {
    const executablePath = await downloadAndUnzipVSCode({
      version: 'stable',
      cachePath: join(extension, '.vscode-test'),
    });
    const profile = mkdtempSync(join(tmpdir(), 'conduktor-ui-'));
    const workspace = join(profile, 'workspace');
    mkdirSync(join(profile, 'data', 'User'), { recursive: true });
    mkdirSync(workspace);
    // Modal dialogs drawn in the window, where a test can answer them, rather than by the OS.
    writeFileSync(join(profile, 'data', 'User', 'settings.json'), JSON.stringify({ 'window.dialogStyle': 'custom' }));
    const app = await electron.launch({
      executablePath,
      ...(options.env && {
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...options.env }).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      }),
      args: [
        `--extensionDevelopmentPath=${options.extension ?? extension}`,
        `--user-data-dir=${join(profile, 'data')}`,
        `--extensions-dir=${join(profile, 'extensions')}`,
        '--disable-extensions',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        // CI runs as a user the setuid sandbox does not accept, without a GPU, and without an OS keyring: VS Code keeps
        // tokens in its own store rather than asking which keyring to use.
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', '--password-store=basic'] : []),
        workspace,
      ],
    });
    const page = await app.firstWindow();
    await page.locator('.monaco-workbench').waitFor({ timeout: 60_000 });
    return new Workbench(app, page);
  }

  close(): Promise<void> {
    return this.app.close();
  }

  /** What the window shows, in test/ui/screenshots: for a test that failed, in CI too. */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: join(extension, 'test', 'ui', 'screenshots', `${name}.png`) });
  }

  /**
   * Runs a command from the palette, by its title. Right after a step completes, the walkthrough page takes focus back
   * and closes a palette opened in that instant: VS Code's own pickers are asked again, unlike the extension's prompts,
   * which have to stay open.
   */
  async command(title: string): Promise<void> {
    await this.again(async () => {
      await this.page.keyboard.press('ControlOrMeta+Shift+P');
      const value = this.page.locator('.quick-input-widget input').filter({ visible: true }).first();
      await value.fill(`>${title}`, { timeout: 3_000 });
      await this.accept(title, 3_000);
    });
    // The palette is gone once no visible prompt holds a command filter.
    await this.page.waitForFunction(
      () =>
        ![...document.querySelectorAll('.quick-input-widget input')].some(
          (input) => input instanceof HTMLInputElement && input.checkVisibility() && input.value.startsWith('>'),
        ),
    );
  }

  /**
   * Waits for the extension's prompt with this title, reads it for a moment as a person would, then types the text in
   * and accepts it. A prompt that closes on its own meanwhile, as one did when focus went back to the walkthrough,
   * fails the test.
   */
  async answer(prompt: string, text: string): Promise<void> {
    const open = this.prompt(prompt);
    await open.waitFor();
    await this.page.waitForTimeout(READING_MS);
    await open.locator('input').first().fill(text, { timeout: 1_000 });
    await this.accept(text);
    if (prompt) await open.waitFor({ state: 'hidden' });
  }

  /** Waits for the prompt with this title, then dismisses it. */
  async dismiss(prompt: string): Promise<void> {
    const open = this.prompt(prompt);
    await open.waitFor();
    await this.page.keyboard.press('Escape');
    await open.waitFor({ state: 'hidden' });
  }

  /** Answers the modal dialog with the button, and returns what it said. */
  async confirm(button: string): Promise<string> {
    const dialog = this.page.locator('.monaco-dialog-box');
    await dialog.waitFor();
    const text = await dialog.innerText();
    await dialog.locator('.monaco-button', { hasText: button }).first().click();
    await dialog.waitFor({ state: 'hidden' });
    return text;
  }

  /** The text the front editor shows, with the spaces it draws as non-breaking ones. */
  async editorText(): Promise<string> {
    const lines = this.page.locator('.editor-group-container.active .monaco-editor .view-lines').first();
    return (await lines.innerText()).replaceAll('\u00a0', ' ');
  }

  /** Brings an open editor to the front, by its tab's label. */
  async focusEditor(label: string | RegExp): Promise<void> {
    await this.page.locator('.tabs-container .tab', { hasText: label }).first().click();
  }

  /** Opens the extension's walkthrough, or brings it back. */
  async walkthrough(): Promise<void> {
    await this.again(async () => {
      await this.command('Welcome: Open Walkthrough...');
      const picker = this.page.locator('.quick-input-widget input').filter({ visible: true }).first();
      await picker.fill(WALKTHROUGH, { timeout: 3_000 });
      await this.accept(WALKTHROUGH, 3_000);
    });
    await this.page.locator('.getting-started-step:not([disabled])').first().waitFor();
  }

  /** The walkthrough's steps, by id, with their title and whether they are done. */
  steps(): Promise<{ id: string; title: string; done: boolean }[]> {
    return this.page.locator('.getting-started-step').evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.getAttribute('data-step-id')?.split('#').pop() ?? '',
        title: button.querySelector('.step-title')?.textContent.trim() ?? '',
        done: button.getAttribute('aria-checked') === 'true',
      })),
    );
  }

  /** Opens a step of the walkthrough and returns the heading of the page beside it, once it shows. */
  async stepPage(id: string, heading: string): Promise<string> {
    await this.select(id);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      for (const frame of this.page.frames()) {
        const shown = await frame
          .locator('h2')
          .first()
          .textContent({ timeout: 100 })
          .catch(() => null);
        if (shown?.trim() === heading) return heading;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error(`The page of step ${id} never showed "${heading}"`);
  }

  /** Clicks the button of a walkthrough step, as a new user would: once the step is open and read. */
  async button(id: string): Promise<void> {
    await this.walkthrough();
    await this.select(id);
    await this.page.waitForTimeout(READING_MS);
    await this.step(id).locator('.button-container a').first().click();
  }

  private step(id: string) {
    return this.page.locator(`.getting-started-step[data-step-id$="#${id}"]`);
  }

  private async select(id: string): Promise<void> {
    const step = this.step(id);
    if ((await step.getAttribute('aria-expanded')) !== 'true') await step.click();
    await this.page.locator(`.getting-started-step.expanded[data-step-id$="#${id}"]`).waitFor();
  }

  private prompt(title: string) {
    const widget = this.page.locator('.quick-input-widget').filter({ visible: true });
    return title ? widget.filter({ has: this.page.locator('.quick-input-title', { hasText: title }) }) : widget;
  }

  // Accepts the prompt once a pick list, if it shows one, has the text's item first.
  private async accept(text: string, timeout?: number): Promise<void> {
    const list = this.page.locator('.quick-input-list').filter({ visible: true });
    if ((await list.count()) > 0)
      await list.locator('.monaco-list-row.focused', { hasText: text }).waitFor({ ...(timeout && { timeout }) });
    await this.page.keyboard.press('Enter');
  }

  // A few tries, closing whatever is left open in between.
  private async again(action: () => Promise<void>): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await action();
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        await this.page.keyboard.press('Escape');
      }
    }
  }
}
