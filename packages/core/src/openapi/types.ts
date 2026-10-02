export type JsonSchema = { [keyword: string]: unknown };

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: JsonSchema;
}

export interface MediaType {
  schema?: JsonSchema;
  example?: unknown;
}

export interface Operation {
  tags?: string[];
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, MediaType> };
}

export interface PathItem {
  get?: Operation;
  put?: Operation;
  post?: Operation;
  delete?: Operation;
  parameters?: Parameter[];
}

export interface OpenApiDoc {
  openapi: string;
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, JsonSchema> };
}
