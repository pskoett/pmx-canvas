import type { CanvasNodeState } from '../types';

export interface ImageNodeWarning {
  title: string;
  detail: string;
}

interface ImageWarningDescriptor {
  title?: unknown;
  detail?: unknown;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function descriptorFromUnknown(value: unknown): ImageNodeWarning | null {
  if (typeof value === 'string') {
    const trimmed = readTrimmedString(value);
    return trimmed ? { title: 'Evidence warning', detail: trimmed } : null;
  }

  if (!value || typeof value !== 'object') return null;
  const descriptor = value as ImageWarningDescriptor;
  const title = readTrimmedString(descriptor.title) ?? 'Evidence warning';
  const detail = readTrimmedString(descriptor.detail);
  return detail ? { title, detail } : null;
}

function metadataWarnings(node: CanvasNodeState): ImageNodeWarning[] {
  const warnings: ImageNodeWarning[] = [];
  const singleWarning = descriptorFromUnknown(node.data.warning);
  if (singleWarning) warnings.push(singleWarning);

  const rawWarnings = node.data.warnings;
  if (Array.isArray(rawWarnings)) {
    for (const candidate of rawWarnings) {
      const warning = descriptorFromUnknown(candidate);
      if (warning) warnings.push(warning);
    }
  }

  const validationStatus = readTrimmedString(node.data.validationStatus)?.toLowerCase();
  if (validationStatus === 'failed' || validationStatus === 'invalid') {
    warnings.push({
      title: 'Image failed validation',
      detail: readTrimmedString(node.data.validationMessage) ?? 'Review this image before using it as evidence.',
    });
  }

  return warnings;
}

function looksLikeLoginCapture(node: CanvasNodeState): boolean {
  const haystack = [
    node.data.title,
    node.data.caption,
    node.data.alt,
    node.data.src,
    node.data.path,
  ]
    .map((value) => readTrimmedString(value)?.toLowerCase() ?? '')
    .join(' ');

  if (haystack.length === 0) return false;

  return [
    'login',
    'log in',
    'sign in',
    'signin',
    'password',
    '2fa',
    'mfa',
    'authenticate',
    'authentication',
    'sso',
  ].some((token) => haystack.includes(token));
}

export function getImageNodeWarnings(node: CanvasNodeState): ImageNodeWarning[] {
  const warnings = metadataWarnings(node);
  if (warnings.length > 0) return warnings;

  if (looksLikeLoginCapture(node)) {
    return [
      {
        title: 'Captured login page',
        detail: 'This image looks like an auth screen. Treat it as environment context, not product evidence.',
      },
    ];
  }

  return [];
}
