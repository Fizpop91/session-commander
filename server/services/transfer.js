import path from 'path';
import { spawn } from 'child_process';
import { getPathStats } from './remoteFs.js';
import { runRemoteCommand } from './ssh.js';
import { buildSessionName } from './naming.js';

const jobs = new Map();
const peerRsyncKeyPath = '$HOME/.ssh/ptsh_peer_ed25519';

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildSshArgs(target, remoteCommand) {
  const privateKey = path.resolve('data/ssh/id_ed25519');

  return [
    '-p',
    String(target.port || 22),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-i',
    privateKey,
    `${target.username}@${target.host}`,
    remoteCommand
  ];
}

function createJob(type) {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const job = {
    jobId,
    type,
    state: 'queued', // queued | running | completed | failed
    phase: 'starting',
    progress: {
      percent: 0,
      transferredBytes: 0,
      speedText: '',
      etaText: ''
    },
    logs: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  jobs.set(jobId, job);
  return job;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function appendJobLog(jobId, line) {
  const job = jobs.get(jobId);
  if (!job || !line) return;

  job.logs.push(line);
  if (job.logs.length > 300) {
    job.logs = job.logs.slice(-300);
  }
  job.updatedAt = new Date().toISOString();
}

function parseHumanSizeToBytes(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([\d.]+)\s*([KMGTPE]?)(B)?$/i);

  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = (match[2] || '').toUpperCase();

  if (!Number.isFinite(amount)) return 0;

  const multipliers = {
    '': 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
    E: 1024 ** 6
  };

  return Math.round(amount * (multipliers[unit] || 1));
}

function parseRsyncProgressLine(line) {
  const cleaned = String(line || '').trim();
  if (!cleaned) return null;

  const match = cleaned.match(
    /^\s*([\d.]+[KMGTPE]?B?)\s+(\d+)%\s+([^\s]+\/s)\s+([0-9:]+)(?:\s+\(xfr#.*\))?\s*$/
  );

  if (!match) return null;

  const [, transferredText, percentText, speedText, etaText] = match;

  return {
    transferredBytes: parseHumanSizeToBytes(transferredText),
    percent: Number(percentText) || 0,
    speedText,
    etaText
  };
}

function wireProgressParsing(jobId, stream, label) {
  let buffer = '';

  stream.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    buffer += text;

    const parts = buffer.split(/\r|\n/);
    buffer = parts.pop() || '';

    for (const rawLine of parts) {
      const line = rawLine.trimEnd();
      if (!line) continue;

      appendJobLog(jobId, `${label}: ${line}`);

      const parsed = parseRsyncProgressLine(line);
      if (parsed) {
        const job = jobs.get(jobId);
        if (job) {
          job.progress = {
            ...job.progress,
            ...parsed
          };
          job.updatedAt = new Date().toISOString();
        }
      }
    }
  });

  stream.on('end', () => {
    const line = buffer.trim();
    if (!line) return;

    appendJobLog(jobId, `${label}: ${line}`);

    const parsed = parseRsyncProgressLine(line);
    if (parsed) {
      const job = jobs.get(jobId);
      if (job) {
        job.progress = {
          ...job.progress,
          ...parsed
        };
        job.updatedAt = new Date().toISOString();
      }
    }
  });
}

async function getOwnershipAndMode(target, rootPath) {
  const command = [
    `owner=$(stat -c %u ${quote(rootPath)} 2>/dev/null || stat -f %u ${quote(rootPath)} 2>/dev/null || echo 0)`,
    `group=$(stat -c %g ${quote(rootPath)} 2>/dev/null || stat -f %g ${quote(rootPath)} 2>/dev/null || echo 0)`,
    `mode=$(stat -c %a ${quote(rootPath)} 2>/dev/null || stat -f %Lp ${quote(rootPath)} 2>/dev/null || echo 755)`,
    'echo "$owner\t$group\t$mode"'
  ].join('; ');

  const { stdout } = await runRemoteCommand(target, command);
  const [owner, group, mode] = stdout.split('\t');

  return {
    owner: Number(owner || 0),
    group: Number(group || 0),
    mode: String(mode || '')
  };
}

async function applyRootPermissionsToCopiedFolder(target, destinationRootPath, copiedFolderPath) {
  if (!destinationRootPath || !copiedFolderPath) {
    return { applied: false };
  }

  try {
    const rootMeta = await getOwnershipAndMode(target, destinationRootPath);

    const command = [
      `chown -R ${rootMeta.owner}:${rootMeta.group} ${quote(copiedFolderPath)} || true`,
      `chmod ${quote(rootMeta.mode)} ${quote(copiedFolderPath)} || true`
    ].join(' && ');

    const result = await runRemoteCommand(target, command);

    return {
      applied: true,
      rootMeta,
      logs: result
    };
  } catch (error) {
    return {
      applied: false,
      warning: `Permission normalization skipped: ${error.message}`
    };
  }
}

async function deleteIfRequested(target, remotePath, mode) {
  if (mode !== 'replace') return;
  await runRemoteCommand(target, `rm -rf ${quote(remotePath)}`);
}

async function ensureParentExists(target, destinationPath) {
  const destinationParent = destinationPath.split('/').slice(0, -1).join('/') || '/';
  await runRemoteCommand(target, `mkdir -p ${quote(destinationParent)}`);
}

function buildRsyncRemoteTarget(target, remotePath) {
  return `${target.username}@${target.host}:${quote(remotePath)}`;
}

function buildPeerSshTarget(target) {
  return `${target.username}@${target.host}`;
}

async function resolveWorkingPeerKeyForRsync(sourceTarget, destinationTarget) {
  const candidateKeys = [peerRsyncKeyPath];

  for (const keyPath of candidateKeys) {
    const testCommand = [
      `key_path=${keyPath}`,
      '[ -f "$key_path" ] || exit 0',
      [
        'ssh',
        '-T',
        '-o',
        'LogLevel=ERROR',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'BatchMode=yes',
        '-i',
        '"$key_path"',
        '-p',
        String(destinationTarget.port || 22),
        quote(buildPeerSshTarget(destinationTarget)),
        quote('true')
      ].join(' '),
      'printf "%s\\n" "$key_path"'
    ].join(' && ');

    try {
      const result = await runRemoteCommand(sourceTarget, testCommand);
      const selected = String(result?.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => line.includes('/.ssh/'))
        .pop();
      if (selected) return selected;
    } catch {
      // try next key candidate
    }
  }

  throw new Error(
    `No working peer SSH key from ${sourceTarget.host} to ${destinationTarget.host}. Re-run Enable for this direction.`
  );
}

function buildRsyncCommand(sourcePath, destinationTarget, destinationPath, keyPath) {
  const sshTransport = [
    'ssh',
    '-T',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-i',
    quote(keyPath),
    '-p',
    String(destinationTarget.port || 22)
  ].join(' ');
  const quotedSshTransport = `"${sshTransport.replace(/"/g, '\\"')}"`;

  return [
    'rsync',
    '-a',
    '--progress',
    '--protocol=29',
    '--rsync-path=rsync',
    '-e',
    quotedSshTransport,
    `${quote(sourcePath)}/`,
    buildRsyncRemoteTarget(destinationTarget, destinationPath)
  ].join(' ');
}

function buildTarCopyCommand(sourcePath, destinationTarget, destinationPath, keyPath) {
  const destinationExtractCommand = [
    `mkdir -p ${quote(destinationPath)}`,
    `tar -xpf - -C ${quote(destinationPath)}`
  ].join(' && ');

  const destinationSshCommand = [
    'ssh',
    '-T',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-i',
    quote(keyPath),
    '-p',
    String(destinationTarget.port || 22),
    quote(buildPeerSshTarget(destinationTarget)),
    quote(destinationExtractCommand)
  ].join(' ');

  return [
    `cd ${quote(sourcePath)}`,
    '&&',
    'tar -cf - .',
    '|',
    destinationSshCommand
  ].join(' ');
}

function runRsyncOverSsh(jobId, sourceTarget, sourcePath, destinationTarget, destinationPath) {
  return new Promise((resolve, reject) => {
    const start = async () => {
      const selectedKey = await resolveWorkingPeerKeyForRsync(sourceTarget, destinationTarget);
      const hasSpaceInPath = /\s/.test(String(sourcePath || '')) || /\s/.test(String(destinationPath || ''));

      if (hasSpaceInPath) {
        appendJobLog(jobId, 'stdout: path contains spaces, using tar-over-ssh transfer mode');
        appendJobLog(jobId, `stdout: source=${sourcePath}`);
        appendJobLog(jobId, `stdout: destination=${destinationPath}`);
        const tarCommand = buildTarCopyCommand(
          sourcePath,
          destinationTarget,
          destinationPath,
          selectedKey
        );
        const tarResult = await runRemoteCommand(sourceTarget, tarCommand);
        if (tarResult?.stdout) appendJobLog(jobId, `stdout: ${tarResult.stdout}`);
        if (tarResult?.stderr) appendJobLog(jobId, `stderr: ${tarResult.stderr}`);
        appendJobLog(jobId, 'stdout: tar-over-ssh transfer completed');
        resolve({ method: 'tar-over-ssh' });
        return;
      }

      const remoteCommand = buildRsyncCommand(
        sourcePath,
        destinationTarget,
        destinationPath,
        selectedKey
      );
      const recentOutputLines = [];
      const rememberLines = (chunk) => {
        const lines = String(chunk || '')
          .split(/\r|\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines) {
          recentOutputLines.push(line);
        }
        if (recentOutputLines.length > 80) {
          recentOutputLines.splice(0, recentOutputLines.length - 80);
        }
      };
      const child = spawn('ssh', buildSshArgs(sourceTarget, remoteCommand), {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      wireProgressParsing(jobId, child.stdout, 'stdout');
      wireProgressParsing(jobId, child.stderr, 'stderr');
      child.stdout.on('data', rememberLines);
      child.stderr.on('data', rememberLines);

      child.on('error', reject);

      child.on('close', async (code) => {
        if (code === 0) {
          resolve({ method: 'rsync' });
          return;
        }

        const outputSummary = recentOutputLines.join(' | ');
        const shouldFallbackToScp =
          /server receiver mode requires two argument/i.test(outputSummary) ||
          /connection unexpectedly closed/i.test(outputSummary) ||
          /Broken pipe/i.test(outputSummary);

        if (shouldFallbackToScp) {
          try {
            appendJobLog(jobId, 'stderr: rsync receiver issue detected, retrying with tar-over-ssh fallback');
            appendJobLog(jobId, `stdout: source=${sourcePath}`);
            appendJobLog(jobId, `stdout: destination=${destinationPath}`);
            const tarCommand = buildTarCopyCommand(
              sourcePath,
              destinationTarget,
              destinationPath,
              selectedKey
            );
            const tarResult = await runRemoteCommand(sourceTarget, tarCommand);
            if (tarResult?.stdout) appendJobLog(jobId, `stdout: ${tarResult.stdout}`);
            if (tarResult?.stderr) appendJobLog(jobId, `stderr: ${tarResult.stderr}`);
            appendJobLog(jobId, 'stdout: tar-over-ssh fallback transfer completed');
            resolve({ method: 'tar-over-ssh' });
            return;
          } catch (fallbackError) {
            reject(new Error(`rsync/tar fallback failed: ${fallbackError.message}`));
            return;
          }
        }

        const meaningfulLine = recentOutputLines
          .filter((line) => !/rsync error: error in rsync protocol data stream/i.test(line))
          .slice(-4)
          .join(' | ');
        reject(
          new Error(
            `rsync exited with code ${code}${meaningfulLine ? `: ${meaningfulLine}` : ''}`
          )
        );
      });
    };

    start().catch(reject);
  });
}

async function executeTransferJob({
  jobId,
  type,
  sourceTarget,
  destinationTarget,
  sourcePath,
  destinationPath,
  destinationRootPath,
  existingMode
}) {
  try {
    const sourceStats = await getPathStats(sourceTarget, sourcePath);
    const estimatedBytes = Number(sourceStats?.sizeBytes || 0);

    updateJob(jobId, {
      state: 'running',
      phase: 'preparing',
      progress: {
        ...jobs.get(jobId)?.progress,
        transferredBytes: 0
      }
    });

    await deleteIfRequested(destinationTarget, destinationPath, existingMode);
    await ensureParentExists(destinationTarget, destinationPath);

    updateJob(jobId, {
      phase: 'transferring'
    });

    const transferResult = await runRsyncOverSsh(
      jobId,
      sourceTarget,
      sourcePath,
      destinationTarget,
      destinationPath
    );

    updateJob(jobId, {
      phase: 'applying-permissions',
      progress: {
        ...jobs.get(jobId).progress,
        percent: 100,
        transferredBytes:
          Number(jobs.get(jobId)?.progress?.transferredBytes || 0) || estimatedBytes
      }
    });

    const permissionResult = await applyRootPermissionsToCopiedFolder(
      destinationTarget,
      destinationRootPath,
      destinationPath
    );

    updateJob(jobId, {
      state: 'completed',
      phase: 'completed',
      result: {
        type,
        method: transferResult?.method || 'rsync',
        destinationPath,
        permissions: permissionResult
      },
      progress: {
        ...jobs.get(jobId)?.progress,
        percent: 100,
        transferredBytes:
          Number(jobs.get(jobId)?.progress?.transferredBytes || 0) || estimatedBytes
      }
    });
  } catch (error) {
    updateJob(jobId, {
      state: 'failed',
      phase: 'failed',
      error: error.message
    });
  }
}

function resolveStorageWorkingTargets(payload = {}) {
  return {
    storageTarget: payload.storageTarget,
    workingTarget: payload.workingTarget
  };
}

export function startRestoreJob(payload = {}) {
  const {
    storageTarget,
    workingTarget,
    sourcePath,
    destinationPath,
    destinationRootPath,
    existingMode = 'skip'
  } = payload;

  const resolved = resolveStorageWorkingTargets({
    storageTarget,
    workingTarget,
    ...payload
  });

  const job = createJob('restore');

  executeTransferJob({
    jobId: job.jobId,
    type: 'restore',
    sourceTarget: resolved.storageTarget,
    destinationTarget: resolved.workingTarget,
    sourcePath,
    destinationPath,
    destinationRootPath,
    existingMode
  });

  return { jobId: job.jobId };
}

export function startBackupJob(payload = {}) {
  const {
    storageTarget,
    workingTarget,
    sourcePath,
    destinationPath,
    destinationRootPath,
    existingMode = 'skip'
  } = payload;

  const resolved = resolveStorageWorkingTargets({
    storageTarget,
    workingTarget,
    ...payload
  });

  const job = createJob('backup');

  executeTransferJob({
    jobId: job.jobId,
    type: 'backup',
    sourceTarget: resolved.workingTarget,
    destinationTarget: resolved.storageTarget,
    sourcePath,
    destinationPath,
    destinationRootPath,
    existingMode
  });

  return { jobId: job.jobId };
}

export function getTransferJobStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error('Transfer job not found');
  }
  return job;
}

export async function compareSourceAndDestination({
  sourceTarget,
  sourcePath,
  destinationTarget,
  destinationPath
}) {
  const [source, destination] = await Promise.all([
    getPathStats(sourceTarget, sourcePath),
    getPathStats(destinationTarget, destinationPath)
  ]);

  return { source, destination };
}

export async function createFromTemplate(payload = {}) {
  const {
    storageTarget,
    workingTarget,
    templatePath,
    destinationParent,
    destinationRootPath,
    clientName,
    projectName,
    projectType,
    date,
    scheme,
    existingMode = 'skip'
  } = payload;

  const resolved = resolveStorageWorkingTargets({
    storageTarget,
    workingTarget,
    ...payload
  });

  const sessionName = buildSessionName({ clientName, projectName, projectType, date, scheme });
  const destinationPath = `${destinationParent}/${sessionName}`;

  await deleteIfRequested(resolved.workingTarget, destinationPath, existingMode);
  await runRemoteCommand(resolved.workingTarget, `mkdir -p ${quote(destinationParent)}`);

  await runRsyncOverSsh(
    createJob('template-create').jobId,
    resolved.storageTarget,
    templatePath,
    resolved.workingTarget,
    destinationPath
  );

  const inspectCommand = [
    `ptx_matches=$(find ${quote(destinationPath)} -type d -name 'Session File Backups' -prune -o -type f -name '*.ptx' -print)`,
    'count=$(printf "%s\\n" "$ptx_matches" | sed "/^$/d" | wc -l)',
    'if [ "$count" -eq 1 ]; then',
    '  ptx=$(printf "%s\\n" "$ptx_matches" | sed "/^$/d" | head -n 1)',
    `  mv "$ptx" ${quote(`${destinationPath}/${sessionName}.ptx`)}`,
    '  echo renamed',
    'elif [ "$count" -eq 0 ]; then',
    '  echo no_ptx_found',
    'else',
    '  echo multiple_ptx_found',
    '  exit 1',
    'fi'
  ].join('\n');

  const renameResult = await runRemoteCommand(resolved.workingTarget, inspectCommand);
  const renameStdout = String(renameResult?.stdout || '');
  const ptxStatus = renameStdout.includes('renamed')
    ? 'renamed'
    : renameStdout.includes('no_ptx_found')
      ? 'no_ptx_found'
      : 'unknown';

  const permissionResult = await applyRootPermissionsToCopiedFolder(
    resolved.workingTarget,
    destinationRootPath,
    destinationPath
  );

  return {
    direction: 'template-create',
    method: 'rsync',
    sessionName,
    destinationPath,
    ptxStatus,
    logs: {
      rename: renameResult,
      permissions: permissionResult
    }
  };
}

export async function inspectTemplatePtx(payload = {}) {
  const { storageTarget, templatePath } = payload;
  const resolved = resolveStorageWorkingTargets({
    storageTarget,
    ...payload
  });

  const inspectCommand = [
    `ptx_matches=$(find ${quote(templatePath)} -type d -name 'Session File Backups' -prune -o -type f -name '*.ptx' -print)`,
    'count=$(printf "%s\\n" "$ptx_matches" | sed "/^$/d" | wc -l)',
    'echo "$count"'
  ].join('\n');

  const result = await runRemoteCommand(resolved.storageTarget, inspectCommand);
  const count = Number(String(result?.stdout || '').trim()) || 0;

  return {
    ptxCount: count,
    hasPtx: count > 0
  };
}
