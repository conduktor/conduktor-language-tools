import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildSpec,
  describeError,
  isRecord,
  presetFromTemplate,
  TOPIC_PRESETS,
  type TopicPreset,
} from '@conduktor/vscode-core';
import {
  CodeLensRefreshRequest,
  CompletionTriggerKind,
  MessageType,
  ShowMessageNotification,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type Connection as LspConnection,
  type InitializeParams,
  type InitializeResult,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CREDENTIAL_VARIABLES, SETTINGS_SECTION } from './connectionSettings';
import { labelCompletions } from './labels';
import {
  APPLY_PRESET,
  presetActions,
  presetEdit,
  topicConfigCompletions,
  topicConfigDiagnostics,
  topicConfigHover,
} from './topicConfigs';
import { atValueStart, Names, referenceCompletions } from './references';
import { COMMANDS, Resources } from './resources';
import { createSchemaService } from './schemaService';
import { isReady, openSession, type Session, type SessionOptions } from './session';

// How long a reference's completion waits for a Console still connecting, before offering the open files' names alone.
const NAMES_WAIT_MS = 3_000;

export interface ServerOptions extends SessionOptions {
  home: string;
}

export function startServer(lsp: LspConnection, options: ServerOptions): void {
  const documents = new TextDocuments(TextDocument);
  const schema = createSchemaService();
  let session: Session | undefined;
  // Dry runs and their actions wait for the Console, rather than answering as if there were none. The schema does not:
  // the bundled one answers until the Console's arrives, so a slow or unreachable Console never holds up typing.
  let loaded!: () => void;
  const sessionLoaded = new Promise<void>((resolve) => (loaded = resolve));
  let bundled!: () => void;
  const schemaReady = new Promise<void>((resolve) => (bundled = resolve));
  let folders: string[] = [];
  let lensRefresh = false;
  let pullsSettings = false;
  let inZed = false;
  // The settings the session was opened with, and how many times they changed: a load that newer settings overtook is
  // dropped.
  let configured: string | undefined;
  let connecting = true;
  let generation = 0;
  let hinted = false;

  // A notification, not window.show*Message: those are requests, which wait on an answer nothing here needs.
  const show = (type: MessageType, message: string) =>
    void lsp.sendNotification(ShowMessageNotification.type, { type, message });
  const refreshLenses = () => {
    if (lensRefresh) void lsp.sendRequest(CodeLensRefreshRequest.type).catch(() => undefined);
  };

  const publish = async (document: TextDocument): Promise<void> => {
    try {
      const catalog = schema.current()?.catalog;
      const diagnostics = [
        ...(await schema.validate(document)),
        ...(catalog ? topicConfigDiagnostics(document, catalog) : []),
        ...resources.diagnostics(document),
      ];
      // An edit made while this ran publishes its own.
      if (documents.get(document.uri)?.version !== document.version) return;
      await lsp.sendDiagnostics({ uri: document.uri, version: document.version, diagnostics });
      if (!hinted && session && !session.connection && schema.claims(document)) {
        hinted = true;
        void hintSetup();
      }
    } catch (error) {
      lsp.console.error(`Checking ${document.uri} failed: ${describeError(error)}`);
    }
  };

  // Credentials are in this server's environment: ${CDK_API_KEY} or ${CONDUKTOR_TOKEN} in a resource must not reach
  // the Console.
  const env = Object.fromEntries(
    Object.entries(options.env).filter(([name]) => !(CREDENTIAL_VARIABLES as readonly string[]).includes(name)),
  );
  const resources = new Resources({
    session: () => (session && isReady(session) ? session : undefined),
    document: (uri) => documents.get(uri),
    workspaceFolders: () => folders,
    env,
    home: options.home,
    changed: (uri) => {
      const document = documents.get(uri);
      if (document) void publish(document);
      refreshLenses();
    },
    show: (level, message) => show(level === 'warning' ? MessageType.Warning : MessageType.Info, message),
    confirm: async (message, action) =>
      (await lsp.window.showWarningMessage(message, { title: action }))?.title === action,
    log: (message) => lsp.console.info(message),
    progress: async (title, task) => {
      const reporter = await lsp.window.createWorkDoneProgress();
      reporter.begin(title);
      try {
        return await task();
      } finally {
        reporter.done();
      }
    },
  });

  /** Once, on the first Console resource opened without a Console to check it against: where to name one. */
  const hintSetup = async () => {
    const zedSettings = join(options.env.XDG_CONFIG_HOME || join(options.home, '.config'), 'zed', 'settings.json');
    const canOpen = inZed && existsSync(zedSettings);
    const choice = await lsp.window.showInformationMessage(
      `Conduktor: no Console set, so only the schema is checked. To dry-run against yours, set CDK_BASE_URL and CDK_API_KEY in your shell as for the conduktor CLI, or add to ${inZed ? "Zed's" : 'your'} settings: "lsp": { "conduktor-console": { "settings": { "url": "https://…", "token": "…" } } }`,
      ...(canOpen ? [{ title: 'Open Settings' }] : []),
    );
    if (choice && canOpen) await lsp.window.showDocument({ uri: pathToFileURL(zedSettings).href, takeFocus: true });
  };

  const configure = async (settings: unknown): Promise<void> => {
    const key = JSON.stringify(settings ?? null);
    if (key === configured) return;
    configured = key;
    const current = ++generation;
    connecting = true;
    const next = await openSession(options, settings).catch((error: unknown) => {
      show(MessageType.Error, `Conduktor: could not load a schema: ${describeError(error)}`);
      return undefined;
    });
    if (current !== generation) return;
    if (next) use(next);
    connecting = false;
    loaded();
  };

  const use = (next: Session) => {
    session = next;
    lsp.console.info(next.info);
    for (const { level, message } of next.alerts)
      show(level === 'error' ? MessageType.Error : MessageType.Warning, message);
    schema.useSpec(next.spec);
    // Results are another Console's answers, or another token's.
    resources.reset();
    void Promise.all(documents.all().map(publish));
    documents.all().forEach((document) => resources.schedule(document.uri, false));
    refreshLenses();
  };

  lsp.onInitialize((params: InitializeParams): InitializeResult => {
    folders = workspaceFolders(params);
    lensRefresh = params.capabilities.workspace?.codeLens?.refreshSupport === true;
    pullsSettings = params.capabilities.workspace?.configuration === true;
    inZed = /^Zed\b/.test(params.clientInfo?.name ?? '');
    return {
      capabilities: {
        textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: { includeText: false } },
        completionProvider: { resolveProvider: false, triggerCharacters: [' '] },
        hoverProvider: true,
        codeLensProvider: { resolveProvider: false },
        codeActionProvider: true,
        executeCommandProvider: { commands: [...Object.values(COMMANDS), APPLY_PRESET] },
      },
      serverInfo: { name: 'conduktor-console', version: options.version },
    };
  });

  // Zed pushes the settings after initializing and whenever they change; other clients may only answer when asked.
  lsp.onInitialized(async () => {
    try {
      const snapshot = buildSpec(await options.snapshotText(), 'snapshot');
      if (!session) schema.useSpec(snapshot);
    } finally {
      bundled();
    }
    const settings = pullsSettings
      ? await lsp.workspace.getConfiguration(SETTINGS_SECTION).catch(() => undefined)
      : undefined;
    await configure(settings);
  });
  lsp.onDidChangeConfiguration(({ settings }) => {
    if (isRecord(settings) && SETTINGS_SECTION in settings) void configure(settings[SETTINGS_SECTION]);
    else if (pullsSettings) void lsp.workspace.getConfiguration(SETTINGS_SECTION).then(configure, () => undefined);
  });

  documents.onDidOpen(({ document }) => resources.schedule(document.uri, false));
  documents.onDidSave(({ document }) => resources.schedule(document.uri, true));
  // TextDocuments fires this on open too, right after onDidOpen: an opened file is published from here.
  documents.onDidChangeContent(({ document }) => {
    if (resources.edited(document.uri)) refreshLenses();
    void publish(document);
  });
  documents.onDidClose(({ document }) => {
    resources.closed(document.uri);
    void lsp.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  const names = new Names({
    session: () => (session && isReady(session) ? session : undefined),
    settled: () => Promise.race([sessionLoaded, new Promise<void>((resolve) => setTimeout(resolve, NAMES_WAIT_MS))]),
    connecting: () => connecting,
    documents: () => documents.all(),
  });

  lsp.onCompletion(async ({ textDocument, position, context }) => {
    await schemaReady;
    const document = documents.get(textDocument.uri);
    const spec = schema.current();
    if (!document || !spec) return null;
    // A space opens completion only where a value starts, so a sentence in a description stays quiet.
    const typedSpace =
      context?.triggerKind === CompletionTriggerKind.TriggerCharacter && context.triggerCharacter === ' ';
    if (typedSpace && !atValueStart(document, position)) return null;
    const list =
      (await referenceCompletions(document, position, spec.catalog, names, { typedSpace })) ??
      (await labelCompletions(document, position, spec.catalog, names, { typedSpace })) ??
      topicConfigCompletions(document, position, spec.catalog) ??
      (await schema.complete(document, position));
    // Nothing to offer after a typed space is no list at all, rather than an empty one.
    return typedSpace && !list?.items.length ? null : list;
  });
  lsp.onHover(async ({ textDocument, position }) => {
    await schemaReady;
    const document = documents.get(textDocument.uri);
    const spec = schema.current();
    if (!document || !spec) return null;
    return topicConfigHover(document, position, spec.catalog) ?? schema.hover(document, position);
  });
  lsp.onCodeLens(async ({ textDocument }) => {
    await sessionLoaded;
    const document = documents.get(textDocument.uri);
    return document ? resources.lenses(document) : [];
  });
  /**
   * Dev mode for this session only, without editing settings: it ends with the server, or when the settings change. Going
   * to dev asks first, as VS Code's Change Mode does; going back to prod does not.
   */
  const switchMode = async (target: unknown) => {
    if (!session || !isReady(session) || (target !== 'dev' && target !== 'prod')) return;
    const { connection } = session;
    if (connection.mode === target) return;
    if (target === 'dev') {
      const question = `Switch ${connection.name} to dev mode until Zed restarts? Apply will then be able to change it, after a dry run and your confirmation.`;
      if ((await lsp.window.showWarningMessage(question, { title: 'Switch to dev' }))?.title !== 'Switch to dev')
        return;
    }
    session = { ...session, connection: { ...connection, mode: target } };
    show(MessageType.Info, `${connection.name} is in ${target} mode${target === 'dev' ? ' until Zed restarts' : ''}.`);
    refreshLenses();
  };

  const modeAction = (): CodeAction[] => {
    if (!session || !isReady(session)) return [];
    const { name, mode } = session.connection;
    const title =
      mode === 'prod'
        ? `Switch ${name} to dev mode, to apply (until Zed restarts)`
        : `Switch ${name} back to prod mode`;
    const target = mode === 'prod' ? 'dev' : 'prod';
    return [{ title, command: { title, command: COMMANDS.switchMode, arguments: [target] } }];
  };

  // The built-in presets, and the Console's own topic templates.
  const topicPresets = async (): Promise<TopicPreset[]> => [
    ...TOPIC_PRESETS,
    ...(await names.consoleResources('TopicTemplate', [])).flatMap((template) => presetFromTemplate(template) ?? []),
  ];

  const applyTopicPreset = async (uri: unknown, start: unknown, id: unknown) => {
    const document = typeof uri === 'string' ? documents.get(uri) : undefined;
    const catalog = schema.current()?.catalog;
    const preset = (await topicPresets()).find((candidate) => candidate.id === id);
    if (!document || !catalog || !preset || typeof start !== 'number') return;
    const edit = presetEdit(document, start, preset, catalog);
    if (edit) await lsp.workspace.applyEdit({ changes: { [document.uri]: [edit] } });
  };

  lsp.onCodeAction(async ({ textDocument, range }) => {
    await sessionLoaded;
    const document = documents.get(textDocument.uri);
    const catalog = schema.current()?.catalog;
    if (!document || !catalog) return [];
    const actions = resources.actions(document, range);
    return [
      ...actions,
      ...(actions.length > 0 ? modeAction() : []),
      ...presetActions(document, range, catalog, await topicPresets()),
    ];
  });
  lsp.onExecuteCommand(async ({ command, arguments: args }) => {
    await sessionLoaded;
    if (command === COMMANDS.switchMode) await switchMode(args?.[0]);
    else if (command === APPLY_PRESET) await applyTopicPreset(args?.[0], args?.[1], args?.[2]);
    else await resources.execute(command, args ?? []);
  });

  documents.listen(lsp);
}

function workspaceFolders(params: InitializeParams): string[] {
  const uris = params.workspaceFolders?.map((folder) => folder.uri) ?? (params.rootUri ? [params.rootUri] : []);
  return uris.filter((uri) => uri.startsWith('file:')).map((uri) => fileURLToPath(uri));
}
