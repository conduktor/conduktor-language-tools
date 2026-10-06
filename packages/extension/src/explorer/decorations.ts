import * as vscode from 'vscode';

/** Only tree items use this scheme, so dimming it never reaches an editor tab. */
export const TREE_SCHEME = 'conduktor-tree';

export function treeUri(kind: string, parents: readonly string[], name: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: TREE_SCHEME,
    path: `/${[kind, ...parents, name].map(encodeURIComponent).join('/')}`,
  });
}

/** Dims resources that exist only in the Console, the way the file explorer dims what git ignores. */
export class ConsoleOnlyDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.FileDecoration | undefined {
    if (uri.scheme !== TREE_SCHEME) return undefined;
    return new vscode.FileDecoration(
      undefined,
      'Only in the Console',
      new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
    );
  }
}
