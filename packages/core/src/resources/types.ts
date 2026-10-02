export interface Resource {
  apiVersion: string;
  kind: string;
  metadata: { name: string; [field: string]: unknown };
  spec?: unknown;
  [field: string]: unknown;
}

export type UpsertResult = 'Created' | 'Updated' | 'NotChanged';

export interface UpsertResponse {
  resource: Resource;
  upsertResult: UpsertResult;
}
