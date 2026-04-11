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
