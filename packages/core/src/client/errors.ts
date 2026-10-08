import { isRecord } from '../util';

export class ConsoleError extends Error {
  override name = 'ConsoleError';

  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(detail ? `${title}: ${detail}` : title);
  }

  static async fromResponse(response: Response): Promise<ConsoleError> {
    const text = await response.text().catch(() => '');
    const body = parseJson(text);
    if (isRecord(body) && typeof body.title === 'string') {
      const detail = [body.msg, body.cause].filter((p): p is string => typeof p === 'string' && p !== '').join('\n');
      return new ConsoleError(response.status, body.title, detail || undefined);
    }
    const title = response.statusText ? `HTTP ${response.status} ${response.statusText}` : `HTTP ${response.status}`;
    const detail = /^\s*</.test(text) ? '' : text.trim().slice(0, 500);
    return new ConsoleError(response.status, title, detail || undefined);
  }
}

export class NetworkError extends Error {
  override name = 'NetworkError';
}

/** An answer that is not the Console's JSON — on a list, an endpoint this Console version does not serve. */
export class UnexpectedResponseError extends ConsoleError {
  override name = 'UnexpectedResponseError';
}

export interface ListProblem {
  kind: 'noAccess' | 'unavailable' | 'failed';
  detail: string;
}

/**
 * Why a list cannot be shown: no access (403); not available — a feature this cluster or Console does not have, such
 * as a Schema Registry or an authorizer (400, 404, or a page where JSON was expected); or a failure (anything else).
 */
export function listProblem(error: unknown): ListProblem {
  if (error instanceof UnexpectedResponseError)
    return { kind: 'unavailable', detail: 'This Console does not serve this kind.' };
  if (error instanceof ConsoleError && error.status === 403) return { kind: 'noAccess', detail: error.message };
  if (error instanceof ConsoleError && (error.status === 400 || error.status === 404))
    return { kind: 'unavailable', detail: error.message };
  return { kind: 'failed', detail: describeError(error) };
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
