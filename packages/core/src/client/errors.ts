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
