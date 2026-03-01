import { Router } from 'express';
import { loadConfig, saveConfig } from '../services/configStore.js';
import {
  hashPassword,
  issueSessionToken,
  normalizeUsername,
  readSecurityFromConfig,
  resolveSessionUserFromHeader,
  revokeSessionToken,
  sanitizeUser,
  verifyPassword
} from '../services/auth.js';

const router = Router();

function ensureSecurity(config = {}) {
  const next = { ...config };
  if (!next.security || typeof next.security !== 'object') {
    next.security = {
      authEnabled: false,
      users: []
    };
  }

  if (!Array.isArray(next.security.users)) {
    next.security.users = [];
  }

  next.security.users = next.security.users.map((user) => ({
    ...user,
    role: user?.role === 'admin' ? 'admin' : 'user'
  }));

  next.security.authEnabled = Boolean(next.security.authEnabled);
  return next;
}

function requireSessionIfEnabled(req, res, authEnabled) {
  if (!authEnabled) return { ok: true, user: null };
  const sessionUser = resolveSessionUserFromHeader(req.headers.authorization);
  if (!sessionUser) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return { ok: false, user: null };
  }
  return { ok: true, user: sessionUser };
}

function requireAdminIfEnabled(req, res, authEnabled) {
  const gate = requireSessionIfEnabled(req, res, authEnabled);
  if (!gate.ok) return gate;
  if (!authEnabled) return gate;
  if (gate.user?.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Admin access required' });
    return { ok: false, user: null };
  }
  return gate;
}

router.get('/status', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    const sessionUser = resolveSessionUserFromHeader(req.headers.authorization);

    res.json({
      ok: true,
      authEnabled,
      requiresAuth: authEnabled,
      hasUsers: users.length > 0,
      hasAdminUser: users.some((user) => user.role === 'admin'),
      authenticated: authEnabled ? Boolean(sessionUser) : true,
      user: sessionUser || null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    if (!authEnabled) {
      return res.status(400).json({ ok: false, error: 'Authentication is disabled' });
    }

    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password are required' });
    }

    const found = users.find((entry) => normalizeUsername(entry.username) === username);
    if (!found || !verifyPassword(password, found.passwordSalt, found.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const token = issueSessionToken(found);
    return res.json({
      ok: true,
      token,
      user: sanitizeUser(found)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const tokenMatch = String(authHeader).match(/^Bearer\s+(.+)$/i);
    if (tokenMatch?.[1]) {
      revokeSessionToken(tokenMatch[1].trim());
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    const gate = requireAdminIfEnabled(req, res, authEnabled);
    if (!gate.ok) return;

    res.json({
      ok: true,
      users: users.map(sanitizeUser)
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    const gate = requireAdminIfEnabled(req, res, authEnabled);
    if (!gate.ok) return;

    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const requestedRole = String(req.body?.role || '').toLowerCase();

    if (!username || username.length < 3) {
      return res.status(400).json({ ok: false, error: 'Username must be at least 3 characters' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    }

    if (users.some((entry) => normalizeUsername(entry.username) === username)) {
      return res.status(400).json({ ok: false, error: 'Username already exists' });
    }

    const passwordPair = hashPassword(password);
    const nextUser = {
      username,
      role: requestedRole === 'admin' ? 'admin' : 'user',
      passwordHash: passwordPair.hash,
      passwordSalt: passwordPair.salt,
      createdAt: new Date().toISOString()
    };

    const nextConfig = {
      ...config,
      security: {
        ...config.security,
        users: [...users, nextUser]
      }
    };

    await saveConfig(nextConfig);
    return res.json({
      ok: true,
      users: nextConfig.security.users.map(sanitizeUser)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.delete('/users/:username', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    const gate = requireAdminIfEnabled(req, res, authEnabled);
    if (!gate.ok) return;

    const username = normalizeUsername(req.params.username);
    if (!username) {
      return res.status(400).json({ ok: false, error: 'Username is required' });
    }

    const filtered = users.filter((entry) => normalizeUsername(entry.username) !== username);
    if (filtered.length === users.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    if (authEnabled && filtered.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'Cannot remove the last user while authentication is enabled' });
    }

    const targetUser = users.find((entry) => normalizeUsername(entry.username) === username);
    const remainingAdmins = filtered.filter((entry) => entry.role === 'admin').length;
    if (authEnabled && targetUser?.role === 'admin' && remainingAdmins === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'Cannot remove the last admin while authentication is enabled' });
    }

    const nextConfig = {
      ...config,
      security: {
        ...config.security,
        users: filtered
      }
    };

    await saveConfig(nextConfig);
    return res.json({
      ok: true,
      users: filtered.map(sanitizeUser)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/users/:username/password', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    const gate = requireAdminIfEnabled(req, res, authEnabled);
    if (!gate.ok) return;

    const username = normalizeUsername(req.params.username);
    const password = String(req.body?.password || '');

    if (!username) {
      return res.status(400).json({ ok: false, error: 'Username is required' });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    }

    const index = users.findIndex((entry) => normalizeUsername(entry.username) === username);
    if (index < 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const passwordPair = hashPassword(password);
    const nextUsers = [...users];
    nextUsers[index] = {
      ...nextUsers[index],
      passwordHash: passwordPair.hash,
      passwordSalt: passwordPair.salt,
      updatedAt: new Date().toISOString()
    };

    const nextConfig = {
      ...config,
      security: {
        ...config.security,
        users: nextUsers
      }
    };

    await saveConfig(nextConfig);
    return res.json({
      ok: true,
      users: nextUsers.map(sanitizeUser)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/password', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    if (!authEnabled) {
      return res.status(400).json({ ok: false, error: 'Authentication is disabled' });
    }

    const gate = requireSessionIfEnabled(req, res, authEnabled);
    if (!gate.ok) return;

    const password = String(req.body?.password || '');
    if (!password || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    }

    const username = normalizeUsername(gate.user?.username);
    const index = users.findIndex((entry) => normalizeUsername(entry.username) === username);
    if (index < 0) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const passwordPair = hashPassword(password);
    const nextUsers = [...users];
    nextUsers[index] = {
      ...nextUsers[index],
      passwordHash: passwordPair.hash,
      passwordSalt: passwordPair.salt,
      updatedAt: new Date().toISOString()
    };

    const nextConfig = {
      ...config,
      security: {
        ...config.security,
        users: nextUsers
      }
    };

    await saveConfig(nextConfig);
    return res.json({
      ok: true,
      user: sanitizeUser(nextUsers[index])
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

router.post('/security', async (req, res) => {
  try {
    const config = ensureSecurity(await loadConfig());
    const { authEnabled, users } = readSecurityFromConfig(config);
    const nextAuthEnabled = Boolean(req.body?.authEnabled);

    const gate = requireAdminIfEnabled(req, res, authEnabled);
    if (!gate.ok) return;

    if (nextAuthEnabled && users.length === 0) {
      return res.status(400).json({ ok: false, error: 'Add at least one admin user before enabling authentication' });
    }

    if (nextAuthEnabled && !users.some((user) => user.role === 'admin')) {
      return res.status(400).json({ ok: false, error: 'Add at least one admin user before enabling authentication' });
    }

    const nextConfig = {
      ...config,
      security: {
        ...config.security,
        authEnabled: nextAuthEnabled
      }
    };

    await saveConfig(nextConfig);
    const response = {
      ok: true,
      authEnabled: nextAuthEnabled
    };

    // When switching from open mode to protected mode, keep the current browser session
    // signed in as an admin to avoid forcing an immediate login handoff.
    if (!authEnabled && nextAuthEnabled) {
      const adminUser = users.find((user) => user.role === 'admin');
      if (adminUser) {
        response.token = issueSessionToken(adminUser);
        response.user = sanitizeUser(adminUser);
      }
    }

    return res.json({
      ...response
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
