/** Mac и iOS: там сочетания подписываются через ⌘. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
