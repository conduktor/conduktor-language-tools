import { readFileSync } from 'node:fs';
import { buildSpec } from '@conduktor/core';

export const snapshotPath = new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url);
export const snapshotSpec = buildSpec(readFileSync(snapshotPath, 'utf8'), 'snapshot');
