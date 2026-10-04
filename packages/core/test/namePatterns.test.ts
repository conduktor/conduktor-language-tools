import { describe, expect, it } from 'vitest';
import { collides, matcher, overlapsOf, patternTraps, patternTypeOf } from '../src/references/patterns';

const names = ['orders', 'orders.v2', 'ordersx', 'payments', 'foo*bar'];
const matching = (...args: Parameters<typeof matcher>) => names.filter(matcher(...args));

describe('pattern readings', () => {
  it('self-serve: LITERAL is equal, PREFIXED is a character prefix, "" claims everything', () => {
    expect(matching('selfServe', 'LITERAL', 'orders')).toEqual(['orders']);
    expect(matching('selfServe', 'PREFIXED', 'orders')).toEqual(['orders', 'orders.v2', 'ordersx']);
    expect(matching('selfServe', 'PREFIXED', '')).toEqual(names);
  });

  it('permissions: * is everything, a trailing * on LITERAL is a prefix, on PREFIXED it is literal', () => {
    expect(matching('rbac', 'LITERAL', '*')).toEqual(names);
    expect(matching('rbac', 'LITERAL', 'orders*')).toEqual(['orders', 'orders.v2', 'ordersx']);
    expect(matching('rbac', 'PREFIXED', '')).toEqual(names);
    expect(matching('rbac', 'PREFIXED', 'foo*')).toEqual(['foo*bar']);
    expect(matching('rbac', 'PREFIXED', 'orders*')).toEqual([]);
  });

  it("ACLs: LITERAL * is Kafka's wildcard", () => {
    expect(matching('kafkaAcl', 'LITERAL', '*')).toEqual(names);
    expect(matching('kafkaAcl', 'LITERAL', 'foo*bar')).toEqual(['foo*bar']);
    expect(matching('kafkaAcl', 'PREFIXED', 'pay')).toEqual(['payments']);
  });

  it('reads patternType without case and defaults to LITERAL', () => {
    expect(patternTypeOf('prefixed')).toBe('PREFIXED');
    expect(patternTypeOf(undefined)).toBe('LITERAL');
  });
});

describe('patternTraps', () => {
  it('says what Console will do with a trailing *', () => {
    expect(patternTraps('selfServe', 'LITERAL', 'orders*')).toEqual([
      { message: "Console rejects a name ending in *: use 'orders' with patternType PREFIXED.", error: true },
    ]);
    expect(patternTraps('rbac', 'LITERAL', 'orders*')).toEqual([
      { message: "Console stores this as PREFIXED 'orders'.", error: false },
    ]);
    expect(patternTraps('rbac', 'PREFIXED', 'orders*')).toEqual([
      { message: "With PREFIXED the * is literal, so this matches nothing: use 'orders'.", error: false },
    ]);
    expect(patternTraps('dataQuality', 'PREFIXED', 'topic-*')).toEqual([
      { message: "The * is matched literally here: use 'topic-' with patternType PREFIXED.", error: false },
    ]);
    expect(patternTraps('rbac', 'LITERAL', '*')).toEqual([]);
    expect(patternTraps('kafkaAcl', 'LITERAL', '*')).toEqual([]);
  });
});

describe('overlap', () => {
  const topic = (name: string, patternType: 'LITERAL' | 'PREFIXED' = 'LITERAL') => ({
    type: 'TOPIC',
    name,
    patternType,
  });

  it('collides when equal, or when one prefix covers the other, for the same type and Connect cluster', () => {
    expect(collides(topic('orders'), topic('orders'))).toBe(true);
    expect(collides(topic('orders', 'PREFIXED'), topic('orders.v2'))).toBe(true);
    expect(collides(topic('orders.v2'), topic('orders', 'PREFIXED'))).toBe(true);
    expect(collides(topic('orders'), topic('orders.v2'))).toBe(false);
    expect(collides(topic('orders', 'PREFIXED'), { ...topic('orders'), type: 'SUBJECT' })).toBe(false);
    expect(
      collides(
        { ...topic('sink', 'PREFIXED'), type: 'CONNECTOR', connectCluster: 'a' },
        { ...topic('sink'), type: 'CONNECTOR', connectCluster: 'b' },
      ),
    ).toBe(false);
  });

  it('finds overlaps with other instances on the same cluster and inside the instance', () => {
    const shop = { name: 'shop-dev', cluster: 'local', resources: [topic('shop.', 'PREFIXED'), topic('shop.orders')] };
    const others = [
      { name: 'billing-dev', cluster: 'local', resources: [topic('shop.invoices')] },
      { name: 'shop-prod', cluster: 'prod', resources: [topic('shop.', 'PREFIXED')] },
    ];
    expect(overlapsOf(shop, others)).toEqual([
      { index: 0, instance: 'shop-dev', resource: topic('shop.orders') },
      { index: 0, instance: 'billing-dev', resource: topic('shop.invoices') },
      { index: 1, instance: 'shop-dev', resource: topic('shop.', 'PREFIXED') },
    ]);
  });
});
