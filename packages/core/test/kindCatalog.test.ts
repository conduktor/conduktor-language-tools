import { describe, expect, it } from 'vitest';
import { InvalidOpenApiError, parseOpenApi } from '../src/openapi/parseOpenApi';
import { cliKinds, snapshotCatalog } from './fixtures';

describe('KindCatalog', () => {
  it('agrees with the cliKind index the Console generates with ctl', () => {
    for (const [kind, { Versions }] of Object.entries(cliKinds)) {
      for (const [version, expected] of Object.entries(Versions)) {
        const actual = snapshotCatalog.resolve(`v${version}`, kind);
        expect(actual, `${kind} v${version}`).toBeDefined();
        expect({
          listPath: actual?.listPath,
          parents: actual?.parentPathParams,
          query: actual?.parentQueryParams,
          order: actual?.order,
        }).toEqual({
          listPath: expected.ListPath,
          parents: expected.ParentPathParam ?? [],
          query: expected.ParentQueryParam ?? [],
          order: expected.Order,
        });
      }
    }
  });

  it('turns kebab-case tag kinds into PascalCase', () => {
    expect(snapshotCatalog.kindNames()).toContain('KsqlDBCluster');
    expect(snapshotCatalog.kindNames()).toContain('ApplicationInstancePermission');
  });

  it('records group, body schema and example', () => {
    const topic = snapshotCatalog.latest('Topic');
    expect(topic).toMatchObject({ kind: 'Topic', version: 2, group: 'kafka', bodySchema: 'TopicResourceV2' });
    expect(topic?.applyExample).toMatchObject({ kind: 'Topic', apiVersion: 'v2' });
  });

  it('resolves by the number in apiVersion and rejects unknown versions', () => {
    expect(snapshotCatalog.resolve('v3', 'Alert')?.listPath).toBe('/public/monitoring/v3/alert');
    expect(snapshotCatalog.resolve('v9', 'Topic')).toBeUndefined();
    expect(snapshotCatalog.resolve('kafka', 'Topic')).toBeUndefined();
  });

  it("resolves the CLI's group-qualified form, in the kind's own group only", () => {
    expect(snapshotCatalog.resolve('kafka/v2', 'Topic')?.version).toBe(2);
    expect(snapshotCatalog.resolve('self-serve/v1', 'ApplicationInstance')?.kind).toBe('ApplicationInstance');
    expect(snapshotCatalog.resolve('iam/v2', 'Topic')).toBeUndefined();
    expect(snapshotCatalog.resolve('apps/v1', 'Topic')).toBeUndefined();
    expect(snapshotCatalog.resolve('argoproj.io/v1alpha1', 'Application')).toBeUndefined();
  });

  it('lists kinds in apply order', () => {
    const orders = snapshotCatalog.kinds().map((k) => k.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(snapshotCatalog.kinds()[0]?.kind).toBe('User');
  });

  it('gives unknown kinds the default order', () => {
    expect(snapshotCatalog.orderOf('Nope')).toBe(1000);
  });
});

describe('parseOpenApi', () => {
  it('rejects HTML served in place of the document', () => {
    expect(() => parseOpenApi('<!doctype html><html><body>Console</body></html>')).toThrow(InvalidOpenApiError);
  });

  it('rejects YAML that is not OpenAPI', () => {
    expect(() => parseOpenApi('kind: Topic')).toThrow('Not an OpenAPI document');
  });
});
