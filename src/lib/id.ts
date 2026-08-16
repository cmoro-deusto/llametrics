/**
 * Collision-avoiding id generation that works in every context.
 * crypto.randomUUID() only exists in secure contexts (https or localhost);
 * a dashboard served over plain http on a LAN IP must not depend on it.
 */
export function genId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
