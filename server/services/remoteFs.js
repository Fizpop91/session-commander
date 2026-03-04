import { runRemoteCommand } from './ssh.js';

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function listDirectory(target, remotePath) {
  const command = [
    'find',
    quote(remotePath),
    '-mindepth', '1',
    '-maxdepth', '1',
    '-exec',
    'sh', '-c', quote('for p; do n=$(basename "$p"); if [ -d "$p" ]; then t=d; else t=f; fi; printf "%s\\t%s\\n" "$n" "$t"; done'),
    'sh',
    '{}',
    '+'
  ].join(' ');

  const { stdout } = await runRemoteCommand(target, command);

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, type] = line.split('\t');
      return {
        name,
        kind: type === 'd' ? 'directory' : 'file'
      };
    })
    .filter((entry) => entry.name && !entry.name.startsWith('.'));
}

export async function getPathStats(target, remotePath) {
  const command = [
    `if [ -e ${quote(remotePath)} ]; then`,
    `  size=$(du -sk ${quote(remotePath)} 2>/dev/null | awk 'NR==1{print $1*1024}')`,
    `  mtime=$(stat -c %Y ${quote(remotePath)} 2>/dev/null || stat -f %m ${quote(remotePath)} 2>/dev/null || echo 0)`,
    `  echo "$size\t$mtime\texists"`,
    'else',
    '  echo "0\t0\tmissing"',
    'fi'
  ].join('\n');

  const { stdout } = await runRemoteCommand(target, command);
  const [size, mtime, status] = stdout.split('\t');

  return {
    exists: status === 'exists',
    sizeBytes: Number(size || 0),
    modifiedEpoch: Number(mtime || 0)
  };
}

export async function deletePath(target, remotePath) {
  const safePath = String(remotePath || '').trim();
  if (!safePath || safePath === '/') {
    throw new Error('Refusing to delete root path');
  }

  const command = [
    `if [ ! -e ${quote(safePath)} ]; then`,
    '  echo missing',
    '  exit 1',
    'fi',
    `if [ -d ${quote(safePath)} ]; then`,
    `  rm -rf ${quote(safePath)}`,
    'else',
    `  rm -f ${quote(safePath)}`,
    'fi',
    'echo deleted'
  ].join('\n');

  await runRemoteCommand(target, command);
  return { ok: true };
}
