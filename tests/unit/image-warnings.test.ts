import { describe, expect, test } from 'bun:test';
import { getImageNodeWarnings } from '../../src/client/nodes/image-warnings.ts';
import { makeNode } from './helpers.ts';

describe('image node warnings', () => {
  test('surfaces explicit validation failures from image metadata', () => {
    const warnings = getImageNodeWarnings(makeNode({
      id: 'image-1',
      type: 'image',
      data: {
        src: '/tmp/canvas.png',
        validationStatus: 'failed',
        validationMessage: 'OCR did not match the expected artifact checksum.',
      },
    }));

    expect(warnings).toEqual([
      {
        title: 'Image failed validation',
        detail: 'OCR did not match the expected artifact checksum.',
      },
    ]);
  });

  test('prefers explicit agent-provided warnings over heuristics', () => {
    const warnings = getImageNodeWarnings(makeNode({
      id: 'image-2',
      type: 'image',
      data: {
        title: 'Login capture',
        src: '/tmp/login.png',
        warning: {
          title: 'Evidence warning',
          detail: 'Agent marked this screenshot as staging-only evidence.',
        },
      },
    }));

    expect(warnings).toEqual([
      {
        title: 'Evidence warning',
        detail: 'Agent marked this screenshot as staging-only evidence.',
      },
    ]);
  });

  test('falls back to a login-capture warning for obvious auth screenshots', () => {
    const warnings = getImageNodeWarnings(makeNode({
      id: 'image-3',
      type: 'image',
      data: {
        title: 'Sign in screen',
        src: '/tmp/staging-login-page.png',
      },
    }));

    expect(warnings).toEqual([
      {
        title: 'Captured login page',
        detail: 'This image looks like an auth screen. Treat it as environment context, not product evidence.',
      },
    ]);
  });
});
