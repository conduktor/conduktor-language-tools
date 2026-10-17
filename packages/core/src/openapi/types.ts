export type JsonSchema = Record<string, unknown>;

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: JsonSchema;
}

interface MediaType {
  schema?: JsonSchema;
  example?: unknown;
}

interface Operation {
  tags?: string[];
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, MediaType> };
}

interface PathItem {
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
