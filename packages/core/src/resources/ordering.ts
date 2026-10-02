import type { KindCatalog } from '../openapi/kindCatalog';
import type { Resource } from './types';

export function sortForApply<T extends { resource?: Resource }>(items: readonly T[], catalog: KindCatalog): T[] {
  const rank = (item: T) => (item.resource ? catalog.orderOf(item.resource.kind) : -1);
  return [...items].sort((a, b) => rank(a) - rank(b));
}
