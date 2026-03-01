import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const sshDir = path.resolve('data/ssh');
const privateKey = path.join(sshDir, 'id_ed25519');
const publicKey = `${privateKey}.pub`;
const remotePeerPrivateKey = '~/.ssh/ptsh_peer_ed25519';
const remotePeerPublicKey = `${remotePeerPrivateKey}.pub`;
const containerKeyComment = 'session-commander-container';
const peerKeyComment = 'session-commander-peer';
const PUBLIC_KEY_LINE_PATTERN = /^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/;

function buildSshTarget(target) {
  return `${target.username}@${target.host}`;
}

function baseSshArgs(target) {
  return [
    '-p',
    String(target.port || 22),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-i',
    privateKey,
    buildSshTarget(target)
  ];
}

function compactOutput(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' | ');
}

async function primeHostKey(target) {
  const args = [
    '-p',
    String(target.port || 22),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    '-o',
    'PreferredAuthentications=none',
    buildSshTarget(target),
    'exit'
  ];

  try {
    await execFileAsync('ssh', args);
  } catch (error) {
    const details = `${error?.stderr || ''} ${error?.message || ''}`;
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(details)) {
      throw new Error(
        `Host key verification failed for ${target.host}. Clear known_hosts for this location and retry.`
      );
    }
    // For preflight, auth failures are expected; we only care about host-key acceptance.
  }
}

async function execPasswordSsh(target, password, remoteCommand, options = {}) {
  const { debug = false } = options;
  const passwordValue = String(password).replace(/\r?\n/g, '');
  await primeHostKey(target);
  const attempts = [
    // Use the most compatible single-pass sshpass mode.
    [
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'NumberOfPasswordPrompts=1',
      '-o',
      'ConnectionAttempts=1'
    ]
  ];

  let lastError = null;
  const diagnostics = [];

  for (let index = 0; index < attempts.length; index += 1) {
    const sshOptions = attempts[index];
    const args = [
      '-e',
      ...(debug ? ['-v'] : []),
      'ssh',
      '-p',
      String(target.port || 22),
      ...sshOptions,
      buildSshTarget(target),
      remoteCommand
    ];

    try {
      const result = await execFileAsync('sshpass', args, {
        env: {
          ...process.env,
          SSHPASS: passwordValue
        }
      });

      if (debug) {
        diagnostics.push(`attempt ${index + 1}: success`);
      }

      return {
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        diagnostics
      };
    } catch (error) {
      lastError = error;
      diagnostics.push(
        `attempt ${index + 1}: ${compactOutput(error?.stderr || error?.message || 'failed')}`
      );
    }
  }

  if (lastError) {
    const details = diagnostics.length ? ` (${diagnostics.join(' ; ')})` : '';
    throw new Error(`Password SSH failed${details}: ${lastError.message}`);
  }

  throw new Error('Password SSH failed');
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function extractPublicKey(output, label = 'public key') {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const found = lines.find((line) => PUBLIC_KEY_LINE_PATTERN.test(line));
  if (!found) {
    throw new Error(`Could not parse ${label} from SSH output`);
  }
  return found;
}

function peerSshTarget(target) {
  return `${target.username}@${target.host}`;
}

export async function generateContainerKeypair() {
  await fs.mkdir(sshDir, { recursive: true });

  try {
    await fs.access(privateKey);
  } catch {
    await execFileAsync('ssh-keygen', [
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      containerKeyComment,
      '-f',
      privateKey
    ]);
  }

  const pub = await fs.readFile(publicKey, 'utf8');
  return { publicKey: extractPublicKey(pub, 'container public key') };
}

export async function getContainerPublicKey() {
  const pub = await fs.readFile(publicKey, 'utf8');
  return extractPublicKey(pub, 'container public key');
}

export async function getContainerKeyStatus() {
  try {
    await fs.access(privateKey);
    await fs.access(publicKey);
    return { hasContainerKey: true };
  } catch {
    return { hasContainerKey: false };
  }
}

export async function testNasConnection(target) {
  const { stdout } = await execFileAsync('ssh', [...baseSshArgs(target), 'echo connected']);

  return { message: stdout.trim() };
}

export async function checkScpInstalled(target) {
  const { stdout } = await execFileAsync('ssh', [
    ...baseSshArgs(target),
    'command -v scp || true'
  ]);

  return {
    installed: Boolean(stdout.trim()),
    path: stdout.trim() || null
  };
}

export async function checkRsyncInstalled(target) {
  const { stdout } = await execFileAsync('ssh', [
    ...baseSshArgs(target),
    'command -v rsync || true'
  ]);

  return {
    installed: Boolean(stdout.trim()),
    path: stdout.trim() || null
  };
}

export async function runRemoteCommand(target, command) {
  const { stdout, stderr } = await execFileAsync('ssh', [...baseSshArgs(target), command]);

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

export async function installContainerKeyWithPassword(target, password) {
  if (!password) {
    throw new Error('Bootstrap password is required');
  }

  const { publicKey } = await generateContainerKeypair();

  const remoteCommand = [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    `grep -F ${quote(publicKey)} ~/.ssh/authorized_keys >/dev/null 2>&1 || echo ${quote(publicKey)} >> ~/.ssh/authorized_keys`
  ].join(' && ');

  const { stdout, stderr } = await execPasswordSsh(target, password, remoteCommand);

  return {
    installed: true,
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

export async function testConnectionWithPassword(target, password) {
  if (!password) {
    throw new Error('Bootstrap password is required');
  }
  const { stdout } = await execPasswordSsh(target, password, 'echo connected', { debug: true });
  return { message: stdout.trim() || 'connected' };
}

export async function generateRemoteKeypairWithPassword(target, password) {
  if (!password) {
    throw new Error('Bootstrap password is required');
  }

  const remoteCommand = [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    `[ -f ${remotePeerPrivateKey} ] || ssh-keygen -t ed25519 -N "" -C ${quote(
      peerKeyComment
    )} -f ${remotePeerPrivateKey} >/dev/null 2>&1`,
    `chmod 600 ${remotePeerPrivateKey}`,
    `chmod 644 ${remotePeerPublicKey}`,
    `cat ${remotePeerPublicKey}`
  ].join(' && ');

  const { stdout } = await execPasswordSsh(target, password, remoteCommand);
  const parsedPublicKey = extractPublicKey(stdout, `${target.host} public key`);

  return {
    publicKey: parsedPublicKey
  };
}

export async function installPeerKeyWithPassword(target, password, keyToInstall) {
  if (!password) {
    throw new Error('Bootstrap password is required');
  }
  const parsedKey = extractPublicKey(keyToInstall, 'peer public key');
  if (!parsedKey) {
    throw new Error('A public key is required');
  }

  const remoteCommand = [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    'chmod 600 ~/.ssh/authorized_keys',
    `grep -F ${quote(parsedKey)} ~/.ssh/authorized_keys >/dev/null 2>&1 || echo ${quote(parsedKey)} >> ~/.ssh/authorized_keys`
  ].join(' && ');

  const { stdout, stderr } = await execPasswordSsh(target, password, remoteCommand);

  return {
    installed: true,
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}

export async function testPeerConnection(sourceTarget, destinationTarget) {
  const command = [
    'ssh',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'PubkeyAuthentication=yes',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'IdentitiesOnly=yes',
    '-i',
    remotePeerPrivateKey,
    '-p',
    String(destinationTarget.port || 22),
    quote(peerSshTarget(destinationTarget)),
    quote('echo peer_connected')
  ].join(' ');

  const result = await runRemoteCommand(sourceTarget, command);

  return {
    message: result.stdout || 'peer_connected',
    stderr: result.stderr || ''
  };
}

function removeLineFromAuthorizedKeysCommand(publicKeyValue) {
  if (!publicKeyValue?.trim()) return 'true';
  return [
    'if [ -f ~/.ssh/authorized_keys ]; then',
    '  tmp_file=$(mktemp)',
    `  grep -F -v -- ${quote(publicKeyValue.trim())} ~/.ssh/authorized_keys > "$tmp_file" || true`,
    '  cat "$tmp_file" > ~/.ssh/authorized_keys',
    '  rm -f "$tmp_file"',
    '  chmod 600 ~/.ssh/authorized_keys',
    'fi'
  ].join('\n');
}

function removePatternFromAuthorizedKeysCommand(pattern) {
  if (!pattern?.trim()) return 'true';
  return [
    'if [ -f ~/.ssh/authorized_keys ]; then',
    '  tmp_file=$(mktemp)',
    `  grep -F -v -- ${quote(pattern.trim())} ~/.ssh/authorized_keys > "$tmp_file" || true`,
    '  cat "$tmp_file" > ~/.ssh/authorized_keys',
    '  rm -f "$tmp_file"',
    '  chmod 600 ~/.ssh/authorized_keys',
    'fi'
  ].join('\n');
}

export async function removeToolKeysFromSystems({ storageTarget, workingTarget }) {
  const warnings = [];

  const safeRun = async (target, command, label) => {
    try {
      if (!target?.host || !target?.username) return;
      await runRemoteCommand(target, command);
    } catch (error) {
      warnings.push(`${label}: ${error.message}`);
    }
  };

  let containerKey = '';
  try {
    containerKey = await getContainerPublicKey();
  } catch {
    containerKey = '';
  }

  let storagePeerKey = '';
  let workingPeerKey = '';

  try {
    if (storageTarget?.host && storageTarget?.username) {
      const result = await runRemoteCommand(
        storageTarget,
        'cat ~/.ssh/ptsh_peer_ed25519.pub 2>/dev/null || true'
      );
      storagePeerKey = result.stdout || '';
    }
  } catch (error) {
    warnings.push(`storage peer key read: ${error.message}`);
  }

  try {
    if (workingTarget?.host && workingTarget?.username) {
      const result = await runRemoteCommand(
        workingTarget,
        'cat ~/.ssh/ptsh_peer_ed25519.pub 2>/dev/null || true'
      );
      workingPeerKey = result.stdout || '';
    }
  } catch (error) {
    warnings.push(`working peer key read: ${error.message}`);
  }

  await safeRun(
    storageTarget,
    [
      removePatternFromAuthorizedKeysCommand(containerKeyComment),
      removePatternFromAuthorizedKeysCommand(peerKeyComment),
      removeLineFromAuthorizedKeysCommand(containerKey),
      removeLineFromAuthorizedKeysCommand(workingPeerKey),
      'rm -f ~/.ssh/ptsh_peer_ed25519 ~/.ssh/ptsh_peer_ed25519.pub'
    ].join('\n'),
    'storage cleanup'
  );

  await safeRun(
    workingTarget,
    [
      removePatternFromAuthorizedKeysCommand(containerKeyComment),
      removePatternFromAuthorizedKeysCommand(peerKeyComment),
      removeLineFromAuthorizedKeysCommand(containerKey),
      removeLineFromAuthorizedKeysCommand(storagePeerKey),
      'rm -f ~/.ssh/ptsh_peer_ed25519 ~/.ssh/ptsh_peer_ed25519.pub'
    ].join('\n'),
    'working cleanup'
  );

  return { warnings };
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readRemotePeerPublicKeyWithPassword(target, password) {
  try {
    const { stdout } = await execPasswordSsh(
      target,
      password,
      'cat ~/.ssh/ptsh_peer_ed25519.pub 2>/dev/null || true'
    );
    return extractPublicKey(stdout, `${target.host} public key`);
  } catch {
    return '';
  }
}

async function inspectRemoteToolKeysWithPassword(target, password) {
  const command = [
    'peer_priv=0; [ -f ~/.ssh/ptsh_peer_ed25519 ] && peer_priv=1',
    'peer_pub=0; [ -f ~/.ssh/ptsh_peer_ed25519.pub ] && peer_pub=1',
    'printf "peer_priv=%s\\npeer_pub=%s\\n" "$peer_priv" "$peer_pub"'
  ].join('; ');

  const { stdout } = await execPasswordSsh(target, password, command);
  const flags = {
    peerPrivate: false,
    peerPublic: false
  };

  for (const line of String(stdout || '').split('\n')) {
    const [key, value] = line.split('=');
    const enabled = String(value || '').trim() === '1';
    if (key === 'peer_priv') flags.peerPrivate = enabled;
    if (key === 'peer_pub') flags.peerPublic = enabled;
  }

  return {
    ...flags,
    hasAny: flags.peerPrivate || flags.peerPublic
  };
}

export async function clearToolKeysWithPasswords({
  storageTarget,
  storagePassword,
  workingTarget,
  workingPassword
}) {
  const warnings = [];
  const localContainerPrivateKey = await fileExists(privateKey);
  const localContainerPublicKey = await fileExists(publicKey);

  const [storageState, workingState] = await Promise.all([
    inspectRemoteToolKeysWithPassword(storageTarget, storagePassword),
    inspectRemoteToolKeysWithPassword(workingTarget, workingPassword)
  ]);

  const keysFound =
    localContainerPrivateKey ||
    localContainerPublicKey ||
    storageState.hasAny ||
    workingState.hasAny;

  if (!keysFound) {
    return {
      warnings,
      keysFound: false,
      cleared: false,
      report: {
        container: {
          before: {
            privateKey: localContainerPrivateKey,
            publicKey: localContainerPublicKey
          },
          after: {
            privateKey: localContainerPrivateKey,
            publicKey: localContainerPublicKey
          },
          removed: false
        },
        storage: {
          before: storageState,
          after: storageState,
          removed: false
        },
        working: {
          before: workingState,
          after: workingState,
          removed: false
        }
      },
      details: {
        localContainerPrivateKey,
        localContainerPublicKey,
        storage: storageState,
        working: workingState
      }
    };
  }

  let containerKey = '';
  try {
    containerKey = await getContainerPublicKey();
  } catch {
    containerKey = '';
  }

  const [storagePeerKey, workingPeerKey] = await Promise.all([
    readRemotePeerPublicKeyWithPassword(storageTarget, storagePassword),
    readRemotePeerPublicKeyWithPassword(workingTarget, workingPassword)
  ]);

  try {
    await execPasswordSsh(
      storageTarget,
      storagePassword,
      [
        removePatternFromAuthorizedKeysCommand(containerKeyComment),
        removePatternFromAuthorizedKeysCommand(peerKeyComment),
        removeLineFromAuthorizedKeysCommand(containerKey),
        removeLineFromAuthorizedKeysCommand(workingPeerKey),
        'rm -f ~/.ssh/ptsh_peer_ed25519 ~/.ssh/ptsh_peer_ed25519.pub'
      ].join('\n')
    );
  } catch (error) {
    warnings.push(`storage cleanup: ${error.message}`);
  }

  try {
    await execPasswordSsh(
      workingTarget,
      workingPassword,
      [
        removePatternFromAuthorizedKeysCommand(containerKeyComment),
        removePatternFromAuthorizedKeysCommand(peerKeyComment),
        removeLineFromAuthorizedKeysCommand(containerKey),
        removeLineFromAuthorizedKeysCommand(storagePeerKey),
        'rm -f ~/.ssh/ptsh_peer_ed25519 ~/.ssh/ptsh_peer_ed25519.pub'
      ].join('\n')
    );
  } catch (error) {
    warnings.push(`working cleanup: ${error.message}`);
  }

  try {
    await fs.rm(privateKey, { force: true });
    await fs.rm(publicKey, { force: true });
  } catch (error) {
    warnings.push(`container key cleanup: ${error.message}`);
  }

  const localContainerPrivateKeyAfter = await fileExists(privateKey);
  const localContainerPublicKeyAfter = await fileExists(publicKey);

  let storageStateAfter = storageState;
  let workingStateAfter = workingState;

  try {
    storageStateAfter = await inspectRemoteToolKeysWithPassword(storageTarget, storagePassword);
  } catch (error) {
    warnings.push(`storage post-check: ${error.message}`);
  }

  try {
    workingStateAfter = await inspectRemoteToolKeysWithPassword(workingTarget, workingPassword);
  } catch (error) {
    warnings.push(`working post-check: ${error.message}`);
  }

  const containerRemoved =
    (localContainerPrivateKey || localContainerPublicKey) &&
    !localContainerPrivateKeyAfter &&
    !localContainerPublicKeyAfter;
  const storageRemoved = storageState.hasAny && !storageStateAfter.hasAny;
  const workingRemoved = workingState.hasAny && !workingStateAfter.hasAny;

  return {
    warnings,
    keysFound: true,
    cleared: true,
    report: {
      container: {
        before: {
          privateKey: localContainerPrivateKey,
          publicKey: localContainerPublicKey
        },
        after: {
          privateKey: localContainerPrivateKeyAfter,
          publicKey: localContainerPublicKeyAfter
        },
        removed: containerRemoved
      },
      storage: {
        before: storageState,
        after: storageStateAfter,
        removed: storageRemoved
      },
      working: {
        before: workingState,
        after: workingStateAfter,
        removed: workingRemoved
      }
    },
    details: {
      localContainerPrivateKey,
      localContainerPublicKey,
      storage: storageState,
      working: workingState
    }
  };
}

export async function refreshContainerKnownHosts({ storageTarget, workingTargets = [] }) {
  const warnings = [];
  const allTargets = [storageTarget, ...(Array.isArray(workingTargets) ? workingTargets : [])].filter(
    (target) => target?.host
  );
  const uniqueHosts = [...new Set(allTargets.map((target) => String(target.host).trim()).filter(Boolean))];

  try {
    await fs.mkdir('/root/.ssh', { recursive: true });
    await fs.writeFile('/root/.ssh/known_hosts', '', { flag: 'a' });
  } catch (error) {
    warnings.push(`container known_hosts init: ${error.message}`);
  }

  for (const host of uniqueHosts) {
    try {
      await execFileAsync('ssh-keygen', ['-R', host, '-f', '/root/.ssh/known_hosts']);
    } catch {
      // no entry or no-op; safe to ignore
    }
  }

  return { warnings, refreshedHosts: uniqueHosts };
}
