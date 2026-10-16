export const LIVE_SCHEME = 'conduktor';
// VS Code only enforces read-only editors per file system, not per file, so editable documents get their own scheme.
export const LIVE_EDIT_SCHEME = 'conduktor-edit';

export function isLiveScheme(scheme: string | undefined): boolean {
  return scheme === LIVE_SCHEME || scheme === LIVE_EDIT_SCHEME;
}

export interface LiveRef {
  connectionId: string;
  kind: string;
  version: number;
  parents: string[];
  name: string;
}

export function toLiveUriParts(
  ref: LiveRef,
  options: { editable?: boolean } = {},
): { scheme: string; authority: string; path: string } {
  const segments = [ref.kind, `v${ref.version}`, ...ref.parents, `${ref.name}.yaml`];
  return {
    scheme: options.editable ? LIVE_EDIT_SCHEME : LIVE_SCHEME,
    authority: ref.connectionId,
    path: `/${segments.map(encodeURIComponent).join('/')}`,
  };
}

export function parseLiveUriParts(authority: string, path: string): LiveRef | undefined {
  let segments: string[];
  try {
    segments = path.split('/').slice(1).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  const [kind, version, ...rest] = segments;
  const file = rest.pop();
  if (!kind || !version || !/^v\d+$/.test(version) || !file?.endsWith('.yaml')) return undefined;
  return { connectionId: authority, kind, version: Number(version.slice(1)), parents: rest, name: file.slice(0, -5) };
}
