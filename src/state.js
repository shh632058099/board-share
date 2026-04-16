export const DEFAULT_LOCAL_ADMIN = {
  userId: 'ou_admin',
  name: '本地管理员',
  enabled: true,
};

export function createDefaultState({ seedLocalAdmin = false } = {}) {
  return {
    boards: [],
    reservations: [],
    returnRequests: [],
    admins: seedLocalAdmin ? [{ ...DEFAULT_LOCAL_ADMIN }] : [],
  };
}

export function normalizeState(value, { seedLocalAdmin = false } = {}) {
  const state = value && typeof value === 'object' ? value : {};
  const normalized = {
    boards: Array.isArray(state.boards) ? state.boards : [],
    reservations: Array.isArray(state.reservations) ? state.reservations : [],
    returnRequests: Array.isArray(state.returnRequests) ? state.returnRequests : [],
    admins: Array.isArray(state.admins) ? state.admins : [],
  };

  if (seedLocalAdmin && !normalized.admins.some((admin) => admin.userId === DEFAULT_LOCAL_ADMIN.userId)) {
    normalized.admins.push({ ...DEFAULT_LOCAL_ADMIN });
  }

  return normalized;
}
