import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import type { Output } from '../output';
import { claimsDocument, SCHEMA_SCHEME, schemaUriFor } from './claim';

const YAML_EXTENSION_ID = 'redhat.vscode-yaml';

interface YamlExtensionApi {
  registerContributor(
    schema: string,
    requestSchema: (resource: string) => string | undefined,
    requestSchemaContent: (uri: string) => string | undefined,
  ): boolean;
}

export async function registerYamlSchemas(sessions: SessionManager, output: Output): Promise<vscode.Disposable> {
  const extension = vscode.extensions.getExtension<YamlExtensionApi>(YAML_EXTENSION_ID);
  if (!extension) {
    void offerYamlExtension();
    return new vscode.Disposable(() => undefined);
  }
  const api = await extension.activate();
  api.registerContributor(
    SCHEMA_SCHEME,
    (resource) => {
      const spec = sessions.loadedSpec();
      const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === resource);
      return spec && document && claimsDocument(document.getText(), spec) ? schemaUriFor(spec) : undefined;
    },
    (uri) => {
      const spec = sessions.loadedSpec();
      return uri.startsWith(`${SCHEMA_SCHEME}:`) && spec ? JSON.stringify(spec.schema) : undefined;
    },
  );
  output.info('Serving Conduktor resource schemas to the YAML extension.');
  return new vscode.Disposable(() => undefined);
}

async function offerYamlExtension(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'Install the Red Hat YAML extension for Conduktor validation, completion and hover.',
    'Install',
  );
  if (choice !== 'Install') return;
  await vscode.commands.executeCommand('workbench.extensions.installExtension', YAML_EXTENSION_ID);
  void vscode.window.showInformationMessage('Reload the window to enable Conduktor schemas.');
}
