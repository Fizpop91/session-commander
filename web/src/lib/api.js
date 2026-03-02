const AUTH_TOKEN_KEY = 'ptsh-auth-token';

function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setAuthToken(token) {
  try {
    if (!token) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return;
    }
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

function clearAuthToken() {
  setAuthToken('');
}

async function request(path, options = {}) {
  const token = getAuthToken();
  const nextHeaders = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    nextHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api${path}`, {
    headers: nextHeaders,
    ...options
  });

  const payload = await response.json();

  if (response.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new Event('ptsh-auth-invalid'));
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

export const api = {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getAuthStatus: () => request('/auth/status'),
  login: async (body) => {
    const payload = await request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
    if (payload?.token) setAuthToken(payload.token);
    return payload;
  },
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      clearAuthToken();
    }
  },
  listUsers: () => request('/auth/users'),
  createUser: (body) => request('/auth/users', { method: 'POST', body: JSON.stringify(body) }),
  deleteUser: (username) =>
    request(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  changeUserPassword: (username, password) =>
    request(`/auth/users/${encodeURIComponent(username)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password })
    }),
  changeOwnPassword: (password) =>
    request('/auth/password', { method: 'POST', body: JSON.stringify({ password }) }),
  setAuthEnabled: async (authEnabled) => {
    const payload = await request('/auth/security', {
      method: 'POST',
      body: JSON.stringify({ authEnabled })
    });
    if (payload?.token) setAuthToken(payload.token);
    return payload;
  },
  health: () => request('/health'),
  getConfig: () => request('/setup/config'),
  saveConfig: (body, configName) =>
    request('/setup/config', { method: 'POST', body: JSON.stringify({ ...body, configName }) }),
  saveNotificationConfig: (notifications) =>
    request('/setup/notifications/config', { method: 'POST', body: JSON.stringify({ notifications }) }),
  clearNotificationConfig: () =>
    request('/setup/notifications/clear', { method: 'POST' }),
  testNotificationEmail: (smtp) =>
    request('/setup/notifications/test-email', { method: 'POST', body: JSON.stringify({ smtp }) }),
  listStoredConfigs: () => request('/setup/configs'),
  loadStoredConfig: (name) =>
    request('/setup/configs/load', { method: 'POST', body: JSON.stringify({ name }) }),
  importConfig: (config, name) =>
    request('/setup/configs/import', { method: 'POST', body: JSON.stringify({ config, name }) }),
  authorizeContainer: (body) =>
    request('/setup/authorize-container', { method: 'POST', body: JSON.stringify(body) }),
  enableStorageToWorking: (body) =>
    request('/setup/peer-trust/storage-to-working', { method: 'POST', body: JSON.stringify(body) }),
  enableWorkingToStorage: (body) =>
    request('/setup/peer-trust/working-to-storage', { method: 'POST', body: JSON.stringify(body) }),
  testBootstrapConnection: (body) =>
    request('/setup/test-bootstrap', { method: 'POST', body: JSON.stringify(body) }),
  testPeerConnection: (body) =>
    request('/setup/test-peer', { method: 'POST', body: JSON.stringify(body) }),
  getSetupKeyStatus: () => request('/setup/key-status'),
  clearSetupConfig: (body) =>
    request('/setup/clear-config', { method: 'POST', body: JSON.stringify(body) }),
  clearSetupConfigAndKeys: (body) =>
    request('/setup/clear-config-and-keys', { method: 'POST', body: JSON.stringify(body) }),
  clearSetupContainerKnownHosts: (body) =>
    request('/setup/clear-container-known-hosts', { method: 'POST', body: JSON.stringify(body) }),

  listDirectory: (body) => request('/browse/list', { method: 'POST', body: JSON.stringify(body) }),
  compareTransfer: (body) =>
    request('/transfer/compare', { method: 'POST', body: JSON.stringify(body) }),
  restore: (body) => request('/transfer/restore', { method: 'POST', body: JSON.stringify(body) }),
  backup: (body) => request('/transfer/backup', { method: 'POST', body: JSON.stringify(body) }),
  getTransferStatus: (jobId) => request(`/transfer/status/${jobId}`),
  previewName: (body) =>
    request('/template/preview-name', { method: 'POST', body: JSON.stringify(body) }),
  checkTemplatePtx: (body) =>
    request('/template/check-ptx', { method: 'POST', body: JSON.stringify(body) }),
  createFromTemplate: (body) =>
    request('/template/create', { method: 'POST', body: JSON.stringify(body) })
};
