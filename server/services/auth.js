import crypto from 'crypto';
import { loadConfig } from './configStore.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const sessions = new Map();

function parseBearerToken(headerValue) {
  const raw = String(headerValue || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getSecurityState(config = {}) {
  const security = config?.security || {};
  const users = Array.isArray(security.users) ? security.users : [];

  return {
    authEnabled: Boolean(security.authEnabled),
    users
  };
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (!session?.expiresAt || session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

export function hashPassword(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  const salt = Buffer.from(saltHex, 'hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return {
    salt: saltHex,
    hash
  };
}

export function verifyPassword(password, saltHex, expectedHashHex) {
  if (!saltHex || !expectedHashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const actual = Buffer.from(crypto.scryptSync(String(password || ''), salt, 64).toString('hex'), 'hex');
  const expected = Buffer.from(String(expectedHashHex), 'hex');

  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function issueSessionToken(user) {
  pruneExpiredSessions();

  const token = crypto.randomBytes(32).toString('hex');
  const username = user?.username || '';
  const role = user?.role || 'user';

  sessions.set(token, {
    username,
    role,
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS
  });

  return token;
}

export function revokeSessionToken(token) {
  if (!token) return;
  sessions.delete(token);
}

export function resolveSessionUserFromHeader(authHeader) {
  pruneExpiredSessions();
  const token = parseBearerToken(authHeader);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return {
    username: session.username,
    role: session.role || 'user'
  };
}

export function normalizeUsername(input) {
  return String(input || '').trim().toLowerCase();
}

export function sanitizeUser(user = {}) {
  return {
    username: user.username || '',
    role: user.role || 'user',
    createdAt: user.createdAt || null
  };
}

export async function authGuard(req, res, next) {
  try {
    const config = await loadConfig();
    const { authEnabled } = getSecurityState(config);

    if (!authEnabled) {
      return next();
    }

    const sessionUser = resolveSessionUserFromHeader(req.headers.authorization);
    if (!sessionUser) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    req.authUser = sessionUser;
    return next();
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export async function adminGuard(req, res, next) {
  try {
    const config = await loadConfig();
    const { authEnabled } = getSecurityState(config);

    if (!authEnabled) {
      return next();
    }

    const sessionUser = resolveSessionUserFromHeader(req.headers.authorization);
    if (!sessionUser) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    if (sessionUser.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    req.authUser = sessionUser;
    return next();
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export function readSecurityFromConfig(config = {}) {
  return getSecurityState(config);
}
