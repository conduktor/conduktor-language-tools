import * as vscode from 'vscode';
import { prettySchema, type Resource } from '@conduktor/vscode-core';

/** A resource as the extension writes it out: a Subject's schema laid out over lines, unless switched off. */
export function asWritten(resource: Resource): Resource {
  const pretty = vscode.workspace.getConfiguration('conduktor.subjects').get<boolean>('prettySchema', true);
  return pretty ? prettySchema(resource) : resource;
}
