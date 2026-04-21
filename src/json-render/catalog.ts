/**
 * json-render catalog definition for PMX Canvas.
 *
 * Uses the shadcn component set from @json-render/shadcn/catalog plus local
 * chart components. The catalog validates specs before they are stored in
 * canvas node state or rendered in the browser viewer.
 */

import { defineCatalog } from '@json-render/core';
import { schema } from './schema.js';
import { shadcnComponentDefinitions } from '@json-render/shadcn/catalog';
import { chartComponentDefinitions } from './charts/definitions';

export const allComponentDefinitions = {
  ...shadcnComponentDefinitions,
  ...chartComponentDefinitions,
};

export const catalog = defineCatalog(schema as never, {
  components: allComponentDefinitions,
} as never);

export interface JsonRenderIssue {
  path?: PropertyKey[];
  message?: string;
}

export interface JsonRenderPropDescriptor {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
}

export interface JsonRenderComponentDescriptor {
  type: string;
  description: string;
  slots: string[];
  example: unknown;
  props: JsonRenderPropDescriptor[];
}

interface JsonRenderValidationResult {
  success: boolean;
  data?: unknown;
  error?: {
    issues?: JsonRenderIssue[];
  };
}

interface ZodishSchema {
  shape?: Record<string, unknown>;
  isOptional?: () => boolean;
  isNullable?: () => boolean;
  safeParse(value: unknown): {
    success: boolean;
    error?: {
      issues?: JsonRenderIssue[];
    };
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function hasSafeParse(value: unknown): value is ZodishSchema {
  return typeof value === 'object' && value !== null && 'safeParse' in value;
}

function schemaTypeName(value: unknown): string {
  const record = asRecord(value);
  const def = asRecord(record?._def) ?? asRecord(record?.def);
  const typeName = def?.typeName ?? def?.type;
  return typeof typeName === 'string' ? typeName : '';
}

function isOptionalSchema(value: unknown): boolean {
  if (typeof (value as ZodishSchema | null)?.isOptional === 'function') {
    return (value as ZodishSchema).isOptional?.() === true;
  }
  const typeName = schemaTypeName(value);
  return typeName === 'ZodOptional' || typeName === 'optional';
}

function isNullableSchema(value: unknown): boolean {
  if (typeof (value as ZodishSchema | null)?.isNullable === 'function') {
    return (value as ZodishSchema).isNullable?.() === true;
  }
  const typeName = schemaTypeName(value);
  return typeName === 'ZodNullable' || typeName === 'nullable';
}

function unwrapSchema(value: unknown): {
  schema: unknown;
  required: boolean;
  nullable: boolean;
} {
  let current = value;
  let required = true;
  let nullable = false;

  while (current) {
    if (isOptionalSchema(current)) {
      required = false;
    }
    if (isNullableSchema(current)) {
      nullable = true;
    }

    const record = asRecord(current);
    const def = asRecord(record?._def) ?? asRecord(record?.def);
    const inner =
      def?.innerType ??
      def?.schema ??
      def?.type ??
      def?.out ??
      def?.in;

    if (!inner || inner === current || (!isOptionalSchema(current) && !isNullableSchema(current))) {
      break;
    }
    current = inner;
  }

  return { schema: current, required, nullable };
}

function schemaTypeLabel(value: unknown): string {
  const { schema, nullable } = unwrapSchema(value);
  const record = asRecord(schema);
  const def = asRecord(record?._def) ?? asRecord(record?.def);
  const typeName = schemaTypeName(schema);

  let label = 'unknown';
  if (typeName === 'ZodString' || typeName === 'string') {
    label = 'string';
  } else if (typeName === 'ZodNumber' || typeName === 'number') {
    label = 'number';
  } else if (typeName === 'ZodBoolean' || typeName === 'boolean') {
    label = 'boolean';
  } else if (typeName === 'ZodArray' || typeName === 'array') {
    const element = def?.type ?? def?.element ?? def?.schema;
    label = `${schemaTypeLabel(element)}[]`;
  } else if (typeName === 'ZodObject' || typeName === 'object') {
    label = 'object';
  } else if (typeName === 'ZodRecord' || typeName === 'record') {
    label = 'record';
  } else if (typeName === 'ZodEnum' || typeName === 'enum') {
    const rawValues = Array.isArray(def?.values)
      ? def.values
      : Array.isArray(def?.entries)
        ? def.entries
        : Array.isArray(def?.options)
          ? def.options
          : [];
    label = rawValues.length > 0
      ? rawValues.map((entry) => JSON.stringify(entry)).join(' | ')
      : 'enum';
  } else if (typeName === 'ZodLiteral' || typeName === 'literal') {
    label = JSON.stringify(def?.value ?? def?.literal ?? 'literal');
  } else if (typeName === 'ZodAny' || typeName === 'any') {
    label = 'any';
  }

  return nullable ? `${label} | null` : label;
}

function describePropsSchema(propsSchema: ZodishSchema): JsonRenderPropDescriptor[] {
  const shape = propsSchema.shape;
  if (!shape || typeof shape !== 'object') return [];

  return Object.entries(shape)
    .map(([name, schema]) => {
      const unwrapped = unwrapSchema(schema);
      return {
        name,
        type: schemaTypeLabel(unwrapped.schema),
        required: unwrapped.required && !unwrapped.nullable,
        nullable: unwrapped.nullable,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function describeJsonRenderCatalog(): JsonRenderComponentDescriptor[] {
  return Object.entries(allComponentDefinitions)
    .map(([type, definition]) => ({
      type,
      description: definition.description ?? '',
      slots: 'slots' in definition && Array.isArray(definition.slots) ? [...definition.slots] : [],
      example: 'example' in definition ? definition.example : undefined,
      props: hasSafeParse(definition.props) ? describePropsSchema(definition.props) : [],
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function normalizePropsForSchema(
  propsSchema: ZodishSchema,
  rawProps: Record<string, unknown>,
): Record<string, unknown> {
  const shape = propsSchema.shape;
  if (!shape || typeof shape !== 'object') return rawProps;

  const normalizedProps = { ...rawProps };
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (!(key in normalizedProps)) {
      if (isNullableSchema(fieldSchema)) {
        normalizedProps[key] = null;
      } else if (isOptionalSchema(fieldSchema)) {
        normalizedProps[key] = undefined;
      }
    }
  }
  return normalizedProps;
}

export function validateShadcnElementProps(spec: unknown): JsonRenderValidationResult {
  const specRecord = asRecord(spec);
  const elements = asRecord(specRecord?.elements);
  if (!elements) {
    return { success: true, data: spec };
  }

  const issues: JsonRenderIssue[] = [];
  for (const [elementKey, rawElement] of Object.entries(elements)) {
    const element = asRecord(rawElement);
    if (!element || typeof element.type !== 'string') continue;

    const definition = allComponentDefinitions[element.type as keyof typeof allComponentDefinitions];
    if (!definition || !hasSafeParse(definition.props)) continue;

    const parsed = definition.props.safeParse(
      normalizePropsForSchema(definition.props, asRecord(element.props) ?? {}),
    );
    if (parsed.success) continue;

    for (const issue of parsed.error?.issues ?? []) {
      const issuePath = Array.isArray(issue.path)
        ? issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment))
        : [];
      issues.push({
        path: ['elements', elementKey, 'props', ...issuePath],
        message: issue.message ?? 'invalid value',
      });
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  return { success: true, data: spec };
}
