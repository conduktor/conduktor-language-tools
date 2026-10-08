import { describe, expect, it } from 'vitest';
import { ConsoleError, listProblem, NetworkError, UnexpectedResponseError } from '../src/client/errors';

describe('listProblem', () => {
  it('reads a feature this cluster or Console lacks as not available, not as a failure', () => {
    for (const error of [
      new ConsoleError(404, 'Schema Registry Not Found', 'Schema Registry not found for cluster local-gateway'),
      new ConsoleError(400, 'No schema registry configured', 'No schema registry is configured for cluster x'),
      new ConsoleError(400, 'Security disabled', 'Security features are disabled.'),
      new UnexpectedResponseError(
        200,
        'http://localhost:8080 did not answer like a Conduktor Console (got text/html).',
      ),
    ])
      expect(listProblem(error).kind, error.message).toBe('unavailable');
    expect(listProblem(new ConsoleError(404, 'Schema Registry Not Found', 'not for local-gateway')).detail).toBe(
      'Schema Registry Not Found: not for local-gateway',
    );
    expect(listProblem(new UnexpectedResponseError(200, 'got text/html')).detail).toBe(
      'This Console does not serve this kind.',
    );
  });

  it('keeps no access and real failures apart', () => {
    expect(listProblem(new ConsoleError(403, 'Forbidden'))).toEqual({ kind: 'noAccess', detail: 'Forbidden' });
    expect(listProblem(new ConsoleError(500, 'Request to Kafka Connect failed')).kind).toBe('failed');
    expect(listProblem(new ConsoleError(401, 'Unauthorized')).kind).toBe('failed');
    expect(listProblem(new NetworkError('connection refused'))).toEqual({
      kind: 'failed',
      detail: 'connection refused',
    });
    expect(listProblem(new Error('boom'))).toEqual({ kind: 'failed', detail: 'boom' });
  });
});
