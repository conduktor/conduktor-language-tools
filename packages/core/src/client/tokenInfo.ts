export type TokenInfo =
  | { type: 'AdminToken'; id: string; name: string; createdBy?: string }
  | { type: 'PersonalAccessToken'; id: string; email: string; name: string }
  | { type: 'ApplicationInstanceToken'; id: string; name: string; applicationInstanceName: string }
  | { type: 'UserToken'; email: string }
  | { type: 'MachineToken'; id: string; name: string; actor: string };

export type Capability = 'admin' | 'user' | 'app';

export class UnsupportedTokenError extends Error {
  override name = 'UnsupportedTokenError';
}

export function capabilityOf(info: TokenInfo): Capability {
  switch (info.type) {
    case 'AdminToken':
      return 'admin';
    case 'PersonalAccessToken':
      return 'user';
    case 'ApplicationInstanceToken':
      return 'app';
    case 'MachineToken':
      throw new UnsupportedTokenError(
        'Machine tokens cannot call the Console REST API. Use a personal access token or an admin API key.',
      );
    case 'UserToken':
      throw new UnsupportedTokenError(
        'This is a browser session token, which expires. Use a personal access token or an admin API key.',
      );
  }
}

export function describeToken(info: TokenInfo): string {
  switch (info.type) {
    case 'AdminToken':
      return `admin API key “${info.name}”`;
    case 'PersonalAccessToken':
      return `${info.email} (personal access token “${info.name}”)`;
    case 'ApplicationInstanceToken':
      return `application instance ${info.applicationInstanceName} (token “${info.name}”)`;
    case 'UserToken':
      return `${info.email} (session)`;
    case 'MachineToken':
      return `machine token “${info.name}” for ${info.actor}`;
  }
}
