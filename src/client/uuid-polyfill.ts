// crypto.randomUUID is only defined in SECURE CONTEXTS. Embedded hosts that
// serve the canvas over plain http inside an iframe (portal/proxy setups) get
// `crypto` without `randomUUID`, which would throw on every per-mount nonce
// (AX tokens, frame tokens, session ids). Polyfill with the standard v4
// fallback; a strict no-op wherever the native implementation exists. These
// ids are nonces/correlation ids, not cryptographic secrets, so Math.random
// quality is acceptable for the fallback path.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as { randomUUID?: () => string }).randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
