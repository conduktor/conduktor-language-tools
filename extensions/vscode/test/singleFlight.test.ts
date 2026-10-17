import { describe, expect, it } from 'vitest';
import { singleFlight } from '../src/sync/singleFlight';

interface Options {
  drift?: boolean;
}

function harness() {
  const runs: { options: Options; finish: () => void; fail: (error: Error) => void }[] = [];
  let active = 0;
  let overlapped = false;
  const refresh = singleFlight<Options>(
    (options) =>
      new Promise<void>((resolve, reject) => {
        active++;
        overlapped ||= active > 1;
        const done = () => active--;
        runs.push({
          options,
          finish: () => {
            done();
            resolve();
          },
          fail: (error) => {
            done();
            reject(error);
          },
        });
      }),
    (a, b) => ({ drift: a.drift === true || b.drift === true }),
  );
  return { refresh, runs, overlapped: () => overlapped };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('singleFlight', () => {
  it('runs a lone call once', async () => {
    const { refresh, runs } = harness();
    const done = refresh({});
    expect(runs).toHaveLength(1);
    runs[0]!.finish();
    await done;
    expect(runs).toHaveLength(1);
  });

  it('runs calls made during a run once more afterwards, never at the same time', async () => {
    const { refresh, runs, overlapped } = harness();
    const first = refresh({});
    const second = refresh({});
    const third = refresh({ drift: true });
    const fourth = refresh({});
    expect(runs).toHaveLength(1);

    runs[0]!.finish();
    await first;
    await settle();
    expect(runs).toHaveLength(2);
    expect(runs[1]!.options).toEqual({ drift: true });

    let finished = false;
    void Promise.all([second, third, fourth]).then(() => (finished = true));
    await settle();
    expect(finished).toBe(false);
    runs[1]!.finish();
    await Promise.all([second, third, fourth]);
    expect(runs).toHaveLength(2);
    expect(overlapped()).toBe(false);
  });

  it('starts a fresh run for a call made after the queued run began', async () => {
    const { refresh, runs } = harness();
    void refresh({});
    void refresh({});
    runs[0]!.finish();
    await settle();
    const late = refresh({});
    runs[1]!.finish();
    await settle();
    expect(runs).toHaveLength(3);
    runs[2]!.finish();
    await late;
  });

  it('still runs the queued call when the running one fails', async () => {
    const { refresh, runs } = harness();
    const failing = refresh({});
    const queued = refresh({});
    runs[0]!.fail(new Error('boom'));
    await expect(failing).rejects.toThrow('boom');
    await settle();
    runs[1]!.finish();
    await expect(queued).resolves.toBeUndefined();
  });
});
