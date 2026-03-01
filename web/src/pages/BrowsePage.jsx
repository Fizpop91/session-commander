import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, CaretCircleLeft, File, FolderSimple } from '@phosphor-icons/react';
import { api } from '../lib/api.js';

const defaultConfig = {
  storageLocation: {
    host: '',
    port: 22,
    username: '',
    rootPath: '/var/nfs/shared/Sessions'
  },
  workingLocations: [
    {
      id: 'working-1',
      name: 'Working Location 1',
      host: '',
      port: 22,
      username: '',
      rootPath: '/mnt/media',
      isPrimary: true,
      setupState: {
        containerAuthorized: false,
        storageToWorking: false,
        workingToStorage: false
      }
    }
  ],
  selectedWorkingLocationId: 'working-1'
};

const ACTIVE_TRANSFER_STORAGE_KEY = 'ptsh-active-transfer';

function normalizeConfig(config) {
  const storageLocation = {
    host: config?.storageLocation?.host || '',
    port: Number(config?.storageLocation?.port || 22),
    username: config?.storageLocation?.username || '',
    rootPath: config?.storageLocation?.rootPath || '/var/nfs/shared/Sessions'
  };

  let workingLocations =
    Array.isArray(config?.workingLocations) && config.workingLocations.length
      ? config.workingLocations.map((drive, index) => ({
          id: drive.id || `working-${index + 1}`,
          name: drive.name || `Working Location ${index + 1}`,
          host: drive.host || '',
          port: Number(drive.port || 22),
          username: drive.username || '',
          rootPath: drive.rootPath || '/mnt/media',
          isPrimary: Boolean(drive.isPrimary),
          setupState: {
            containerAuthorized: Boolean(drive?.setupState?.containerAuthorized),
            storageToWorking: Boolean(drive?.setupState?.storageToWorking),
            workingToStorage: Boolean(drive?.setupState?.workingToStorage)
          }
        }))
      : [...defaultConfig.workingLocations];

  if (!workingLocations.some((drive) => drive.isPrimary)) {
    workingLocations = workingLocations.map((drive, index) => ({
      ...drive,
      isPrimary: index === 0
    }));
  }

  const selectedWorkingLocationId =
    config?.selectedWorkingLocationId ||
    workingLocations.find((drive) => drive.isPrimary)?.id ||
    workingLocations[0]?.id ||
    null;

  return {
    storageLocation,
    workingLocations,
    selectedWorkingLocationId
  };
}

function hasConfiguredTarget(target) {
  return Boolean(target?.host?.trim() && target?.username?.trim() && target?.rootPath?.trim());
}

function isSetupComplete(config, selectedWorkingLocationId) {
  const storageReady = hasConfiguredTarget(config?.storageLocation);
  const working =
    config?.workingLocations?.find((drive) => drive.id === selectedWorkingLocationId) ||
    config?.workingLocations?.[0] ||
    null;
  const workingReady = hasConfiguredTarget(working);
  const setupState = working?.setupState || {};
  const trustReady =
    Boolean(setupState.containerAuthorized) &&
    Boolean(setupState.storageToWorking) &&
    Boolean(setupState.workingToStorage);

  return storageReady && workingReady && trustReady;
}

function joinRemotePath(basePath, name) {
  const safeBase = String(basePath || '').replace(/\/+$/, '');
  return safeBase ? `${safeBase}/${name}` : name;
}

function getParentPath(path, rootPath) {
  const safePath = String(path || '').replace(/\/+$/, '');
  const safeRoot = String(rootPath || '').replace(/\/+$/, '');

  if (!safePath || safePath === safeRoot) return safeRoot;

  const lastSlash = safePath.lastIndexOf('/');
  if (lastSlash <= 0) return safeRoot;

  const parent = safePath.slice(0, lastSlash);
  if (parent.length < safeRoot.length) return safeRoot;
  return parent || safeRoot;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatEpoch(epoch) {
  const value = Number(epoch || 0);
  if (!value) return '—';
  return new Date(value * 1000).toLocaleString();
}

function toTitleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getRootDisplayLabel(rootPath) {
  const parts = String(rootPath || '')
    .split('/')
    .filter(Boolean);

  const dataIndex = parts.indexOf('.data');
  if (dataIndex > 0) {
    return toTitleCase(parts[dataIndex - 1]);
  }

  return toTitleCase(parts[parts.length - 1] || 'Root');
}

function getReadableLocation(currentPath, rootPath) {
  const safeCurrent = String(currentPath || '').replace(/\/+$/, '');
  const safeRoot = String(rootPath || '').replace(/\/+$/, '');
  const rootLabel = getRootDisplayLabel(rootPath);

  if (!safeCurrent || safeCurrent === safeRoot) {
    return rootLabel;
  }

  const relative = safeCurrent.startsWith(`${safeRoot}/`)
    ? safeCurrent.slice(safeRoot.length + 1)
    : '';

  if (!relative) {
    return rootLabel;
  }

  const relativeLabel = relative
    .split('/')
    .filter(Boolean)
    .map((part) => toTitleCase(part))
    .join(' / ');

  return `${rootLabel} / ${relativeLabel}`;
}

function getReadableLocationPreserveNames(currentPath, rootPath) {
  const safeCurrent = String(currentPath || '').replace(/\/+$/, '');
  const safeRoot = String(rootPath || '').replace(/\/+$/, '');
  const rootLabel = getRootDisplayLabel(rootPath);

  if (!safeCurrent || safeCurrent === safeRoot) {
    return rootLabel;
  }

  const relative = safeCurrent.startsWith(`${safeRoot}/`)
    ? safeCurrent.slice(safeRoot.length + 1)
    : '';

  if (!relative) {
    return rootLabel;
  }

  const relativeLabel = relative
    .split('/')
    .filter(Boolean)
    .join(' / ');

  return `${rootLabel} / ${relativeLabel}`;
}

function formatTransferDestination(destinationPath) {
  const parts = String(destinationPath || '')
    .split('/')
    .filter(Boolean);

  if (!parts.length) return '/';
  if (parts.length === 1) return toTitleCase(parts[0]);

  const shareName = toTitleCase(parts[parts.length - 2]);
  const sessionName = parts[parts.length - 1];

  return `${shareName} / ${sessionName}`;
}

function getFreshnessFlags(result) {
  const sourceExists = Boolean(result?.source?.exists);
  const destinationExists = Boolean(result?.destination?.exists);
  const sourceEpoch = Number(result?.source?.modifiedEpoch || 0);
  const destinationEpoch = Number(result?.destination?.modifiedEpoch || 0);

  if (sourceExists && !destinationExists) {
    return { source: 'new', destination: 'missing' };
  }

  if (!sourceExists && destinationExists) {
    return { source: 'missing', destination: 'newer' };
  }

  if (!sourceExists && !destinationExists) {
    return { source: 'missing', destination: 'missing' };
  }

  if (sourceEpoch === destinationEpoch) {
    return { source: 'match', destination: 'match' };
  }

  if (sourceEpoch > destinationEpoch) {
    return { source: 'newer', destination: 'older' };
  }

  return { source: 'older', destination: 'newer' };
}

function getFreshnessLabel(flag) {
  if (flag === 'new') return 'New';
  if (flag === 'newer') return 'Newer';
  if (flag === 'older') return 'Older';
  if (flag === 'missing') return "Doesn't Exist";
  return 'Match';
}

function validateTargetForBrowse(target, side) {
  if (!target?.host?.trim()) {
    throw new Error(`${side === 'storage' ? 'Storage location' : 'Working location'} host is not configured. Ask an admin to complete setup.`);
  }
  if (!target?.username?.trim()) {
    throw new Error(`${side === 'storage' ? 'Storage location' : 'Working location'} username is not configured. Ask an admin to complete setup.`);
  }
}

function saveActiveTransfer(activeTransfer) {
  if (!activeTransfer?.jobId) {
    localStorage.removeItem(ACTIVE_TRANSFER_STORAGE_KEY);
    return;
  }

  localStorage.setItem(ACTIVE_TRANSFER_STORAGE_KEY, JSON.stringify(activeTransfer));
}

function loadSavedActiveTransfer() {
  try {
    const raw = localStorage.getItem(ACTIVE_TRANSFER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.jobId ? parsed : null;
  } catch {
    localStorage.removeItem(ACTIVE_TRANSFER_STORAGE_KEY);
    return null;
  }
}

export default function BrowsePage() {
  const initialSavedTransfer = loadSavedActiveTransfer();

  const [config, setConfig] = useState(defaultConfig);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [selectedWorkingLocationId, setSelectedWorkingLocationId] = useState(
    defaultConfig.selectedWorkingLocationId
  );

  const [notice, setNotice] = useState({
    tone: 'pending',
    text: ''
  });

  const [paths, setPaths] = useState({
    storage: defaultConfig.storageLocation.rootPath,
    working: defaultConfig.workingLocations[0].rootPath
  });

  const [entries, setEntries] = useState({
    storage: [],
    working: []
  });

  const [loading, setLoading] = useState({
    storage: false,
    working: false
  });

  const [selected, setSelected] = useState({
    storage: null,
    working: null
  });

  const [compareState, setCompareState] = useState({
    type: null,
    source: null,
    destination: null,
    destinationPath: '',
    result: null
  });

  const [comparingType, setComparingType] = useState(null);
  const [transferLogs, setTransferLogs] = useState(null);

  const [activeTransfer, setActiveTransfer] = useState(initialSavedTransfer);
  const [transferProgress, setTransferProgress] = useState({
    percent: 0,
    transferredBytes: 0,
    speedText: '',
    etaText: '',
    phase: ''
  });

  const pollRef = useRef(null);
  const compareActionsRef = useRef(null);
  const transferDetailsRef = useRef(null);
  const [pendingCompareScroll, setPendingCompareScroll] = useState(false);
  const [pendingTransferScroll, setPendingTransferScroll] = useState(false);

  const currentWorkingLocation = useMemo(() => {
    return (
      config.workingLocations.find((drive) => drive.id === selectedWorkingLocationId) ||
      config.workingLocations[0] ||
      null
    );
  }, [config.workingLocations, selectedWorkingLocationId]);
  const setupComplete = useMemo(
    () => isSetupComplete(config, selectedWorkingLocationId),
    [config, selectedWorkingLocationId]
  );

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      try {
        const loadedConfig = await api.getConfig();
        if (!active) return;

        const normalized = normalizeConfig(loadedConfig);
        const initialWorkingLocation =
          normalized.workingLocations.find((drive) => drive.id === normalized.selectedWorkingLocationId) ||
          normalized.workingLocations[0] ||
          null;

        setConfig(normalized);
        setSelectedWorkingLocationId(normalized.selectedWorkingLocationId);

        const initialPaths = {
          storage: normalized.storageLocation.rootPath,
          working: initialWorkingLocation?.rootPath || '/mnt/media'
        };

        setPaths(initialPaths);

        if (!isSetupComplete(normalized, normalized.selectedWorkingLocationId)) {
          setNotice({
            tone: 'pending',
            text: 'Setup wizard must be completed first. Go to Settings and complete all 3 setup steps to continue.'
          });
          return;
        }

        await Promise.all([
          loadLocationDirectory(
            'storage',
            initialPaths.storage,
            normalized,
            normalized.selectedWorkingLocationId
          ),
          loadLocationDirectory(
            'working',
            initialPaths.working,
            normalized,
            normalized.selectedWorkingLocationId
          )
        ]);
      } catch (error) {
        if (!active) return;
        setNotice({
          tone: 'error',
          text: `Failed to load Browse page: ${error.message}`
        });
      } finally {
        if (active) setLoadingConfig(false);
      }
    }

    loadInitial();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialSavedTransfer?.jobId) {
      setNotice((current) => {
        if (current.text) return current;
        return {
          tone: 'pending',
          text: 'Reconnected to an active transfer.'
        };
      });
    }
  }, []);

  useEffect(() => {
    saveActiveTransfer(activeTransfer);
  }, [activeTransfer]);

  useEffect(() => {
    if (!activeTransfer?.jobId) return;

    function handleBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
      return '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [activeTransfer?.jobId]);

  useEffect(() => {
    if (loadingConfig || !currentWorkingLocation || !setupComplete) return;

    setPaths((current) => ({
      ...current,
      working: currentWorkingLocation.rootPath
    }));

    loadLocationDirectory('working', currentWorkingLocation.rootPath, undefined, currentWorkingLocation.id);
  }, [loadingConfig, currentWorkingLocation?.id, setupComplete]);

  useEffect(() => {
    if (!pendingCompareScroll || !compareState.result) return;

    requestAnimationFrame(() => {
      compareActionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingCompareScroll(false);
    });
  }, [pendingCompareScroll, compareState.result]);

  useEffect(() => {
    const isRunning = Boolean(activeTransfer?.jobId);
    if (!pendingTransferScroll || (!isRunning && !transferLogs)) return;

    requestAnimationFrame(() => {
      transferDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingTransferScroll(false);
    });
  }, [pendingTransferScroll, activeTransfer?.jobId, transferLogs]);

  useEffect(() => {
    if (!activeTransfer?.jobId) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    async function pollStatus() {
      try {
        const job = await api.getTransferStatus(activeTransfer.jobId);

        setTransferProgress({
          percent: Number(job.progress?.percent || 0),
          transferredBytes: Number(job.progress?.transferredBytes || 0),
          speedText: job.progress?.speedText || '',
          etaText: job.progress?.etaText || '',
          phase: job.phase || ''
        });

        if (job.state === 'completed') {
          clearInterval(pollRef.current);
          pollRef.current = null;

          setTransferLogs(job);
          setActiveTransfer(null);

          if (job.type === 'restore') {
            await loadLocationDirectory('working', paths.working, undefined, selectedWorkingLocationId);
            setNotice({
              tone: 'success',
              text: 'Restore complete.'
            });
          } else {
            await loadLocationDirectory('storage', paths.storage, undefined, selectedWorkingLocationId);
            setNotice({
              tone: 'success',
              text: 'Backup complete.'
            });
          }

          setCompareState({
            type: null,
            source: null,
            destination: null,
            destinationPath: '',
            result: null
          });
        }

        if (job.state === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;

          setTransferLogs(job);
          setActiveTransfer(null);
          setNotice({
            tone: 'error',
            text: `Transfer failed: ${job.error || 'Unknown error'}`
          });
        }
      } catch (error) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setActiveTransfer(null);
        setNotice({
          tone: 'error',
          text: `Progress update failed: ${error.message}`
        });
      }
    }

    pollStatus();
    pollRef.current = setInterval(pollStatus, 1000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeTransfer?.jobId, paths.storage, paths.working, selectedWorkingLocationId]);

  async function loadLocationDirectory(side, explicitPath, overrideConfig, overrideWorkingLocationId) {
    const activeConfig = overrideConfig || config;

    let target;
    if (side === 'storage') {
      target = activeConfig.storageLocation;
    } else {
      const workingLocationId =
        overrideWorkingLocationId || overrideConfig?.selectedWorkingLocationId || selectedWorkingLocationId;

      target =
        activeConfig.workingLocations.find((drive) => drive.id === workingLocationId) ||
        activeConfig.workingLocations[0] ||
        null;
    }

    const path =
      explicitPath ||
      (side === 'storage'
        ? activeConfig.storageLocation.rootPath
        : target?.rootPath || '/mnt/media');

    if (!target) return;

    try {
      validateTargetForBrowse(target, side);
      setLoading((current) => ({ ...current, [side]: true }));

      const result = await api.listDirectory({
        target: {
          host: target.host,
          port: target.port,
          username: target.username
        },
        path
      });

      const sorted = [...(result.entries || [])].sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      setEntries((current) => ({
        ...current,
        [side]: sorted
      }));

      setPaths((current) => ({
        ...current,
        [side]: path
      }));

      setSelected((current) => ({
        ...current,
        [side]: null
      }));
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `Failed to load ${
          side === 'storage' ? 'Storage Location' : target.name || 'Working Location'
        } directory: ${error.message}`
      });

      setEntries((current) => ({
        ...current,
        [side]: []
      }));
    } finally {
      setLoading((current) => ({ ...current, [side]: false }));
    }
  }

  function handleSelectEntry(side, entry) {
    const fullPath = joinRemotePath(paths[side], entry.name);

    setSelected((current) => ({
      ...current,
      [side]:
        current[side]?.name === entry.name &&
        current[side]?.kind === entry.kind &&
        current[side]?.path === fullPath
          ? null
          : {
              ...entry,
              path: fullPath
            }
    }));

    setCompareState({
      type: null,
      source: null,
      destination: null,
      destinationPath: '',
      result: null
    });
  }

  async function handleOpenEntry(side, entry) {
    if (!entry || entry.kind !== 'directory') return;
    await loadLocationDirectory(
      side,
      joinRemotePath(paths[side], entry.name),
      undefined,
      selectedWorkingLocationId
    );
  }

  async function handleBackOneLevel(side) {
    const rootPath =
      side === 'storage'
        ? config.storageLocation.rootPath
        : currentWorkingLocation?.rootPath || '/mnt/media';

    const nextPath = getParentPath(paths[side], rootPath);
    await loadLocationDirectory(side, nextPath, undefined, selectedWorkingLocationId);
  }

  async function handleGoToLocationRoot(side) {
    const rootPath =
      side === 'storage'
        ? config.storageLocation.rootPath
        : currentWorkingLocation?.rootPath || '/mnt/media';

    await loadLocationDirectory(side, rootPath, undefined, selectedWorkingLocationId);
  }

  async function handleCompareTransfer(type) {
    try {
      setComparingType(type);
      setNotice((current) => ({ ...current, text: '' }));
      setTransferLogs(null);

      const isRestore = type === 'restore';
      const sourceSide = isRestore ? 'storage' : 'working';
      const destinationSide = isRestore ? 'working' : 'storage';

      const sourceItem = selected[sourceSide];
      const sourceLocationName =
        sourceSide === 'storage' ? 'Storage Location' : currentWorkingLocation?.name || 'Working Location';

      if (!sourceItem || sourceItem.kind !== 'directory') {
        throw new Error(`Select a source folder on the ${sourceLocationName} side first`);
      }

      const destinationPath = joinRemotePath(paths[destinationSide], sourceItem.name);

      const sourceTarget = sourceSide === 'storage' ? config.storageLocation : currentWorkingLocation;
      const destinationTarget =
        destinationSide === 'storage' ? config.storageLocation : currentWorkingLocation;

      const result = await api.compareTransfer({
        sourceTarget: {
          host: sourceTarget.host,
          port: sourceTarget.port,
          username: sourceTarget.username
        },
        sourcePath: sourceItem.path,
        destinationTarget: {
          host: destinationTarget.host,
          port: destinationTarget.port,
          username: destinationTarget.username
        },
        destinationPath
      });

      setCompareState({
        type,
        source: {
          side: sourceSide,
          item: sourceItem
        },
        destination: {
          side: destinationSide
        },
        destinationPath,
        result
      });
      setPendingCompareScroll(true);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `Compare failed: ${error.message}`
      });

      setCompareState({
        type: null,
        source: null,
        destination: null,
        destinationPath: '',
        result: null
      });
    } finally {
      setComparingType(null);
    }
  }

  async function handleStartTransfer(existingMode) {
    try {
      if (!compareState.type || !compareState.result) {
        throw new Error('Run compare first');
      }

      const destinationExists = Boolean(compareState.result.destination?.exists);

      if (destinationExists && existingMode === 'skip') {
        setNotice({
          tone: 'pending',
          text: 'Transfer skipped.'
        });

        setCompareState({
          type: null,
          source: null,
          destination: null,
          destinationPath: '',
          result: null
        });
        return;
      }

      setNotice((current) => ({ ...current, text: '' }));
      setTransferLogs(null);
      setTransferProgress({
        percent: 0,
        transferredBytes: 0,
        speedText: '',
        etaText: '',
        phase: 'starting'
      });

      if (!currentWorkingLocation) {
        throw new Error('Select a Working Location first');
      }

      if (compareState.type === 'restore') {
        const result = await api.restore({
          storageTarget: {
            host: config.storageLocation.host,
            port: config.storageLocation.port,
            username: config.storageLocation.username
          },
          workingTarget: {
            host: currentWorkingLocation.host,
            port: currentWorkingLocation.port,
            username: currentWorkingLocation.username
          },
          sourcePath: compareState.source.item.path,
          destinationPath: compareState.destinationPath,
          destinationRootPath: currentWorkingLocation.rootPath,
          existingMode
        });

        const nextActiveTransfer = {
          jobId: result.jobId,
          type: 'restore',
          workingLocationId: currentWorkingLocation.id
        };

        saveActiveTransfer(nextActiveTransfer);
        setActiveTransfer(nextActiveTransfer);
        setPendingTransferScroll(true);
      } else {
        const result = await api.backup({
          workingTarget: {
            host: currentWorkingLocation.host,
            port: currentWorkingLocation.port,
            username: currentWorkingLocation.username
          },
          storageTarget: {
            host: config.storageLocation.host,
            port: config.storageLocation.port,
            username: config.storageLocation.username
          },
          sourcePath: compareState.source.item.path,
          destinationPath: compareState.destinationPath,
          destinationRootPath: config.storageLocation.rootPath,
          existingMode
        });

        const nextActiveTransfer = {
          jobId: result.jobId,
          type: 'backup',
          workingLocationId: currentWorkingLocation.id
        };

        saveActiveTransfer(nextActiveTransfer);
        setActiveTransfer(nextActiveTransfer);
        setPendingTransferScroll(true);
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `Transfer failed: ${error.message}`
      });
    }
  }

  const canRestore = useMemo(
    () => Boolean(selected.storage && selected.storage.kind === 'directory'),
    [selected.storage]
  );

  const canBackup = useMemo(
    () => Boolean(selected.working && selected.working.kind === 'directory'),
    [selected.working]
  );

  const transferRunning = Boolean(activeTransfer?.jobId);
  const compareFreshness = compareState.result ? getFreshnessFlags(compareState.result) : null;
  const destinationIsNewerWarning = Boolean(
    compareState.result?.source?.exists &&
      compareState.result?.destination?.exists &&
      Number(compareState.result?.source?.modifiedEpoch || 0) <
        Number(compareState.result?.destination?.modifiedEpoch || 0)
  );

  if (loadingConfig) {
    return (
      <section className="panel">
        <h2>Restore / Backup Session</h2>
        <p>Loading configuration…</p>
      </section>
    );
  }

  if (!setupComplete) {
    return (
      <section className="content">
        <section className="panel step-panel">
          <div className="result-banner pending">
            Setup wizard must be completed first. Go to Settings and complete all 3 setup steps to
            continue.
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="content">
      <section className="panel hero-panel">
        <div className="panel-header">
          <div>
            <h2>Restore / Backup Session</h2>
            <p>Select a folder to restore or backup, compare the destination, then run the transfer.</p>
          </div>
        </div>

      </section>

      <section className="grid two-col">
        <BrowserPane
          title="Storage Location"
          currentPath={paths.storage}
          rootPath={config.storageLocation.rootPath}
          entries={entries.storage}
          selectedItem={selected.storage}
          loading={loading.storage}
          onRefresh={() =>
            loadLocationDirectory('storage', paths.storage, undefined, selectedWorkingLocationId)
          }
          onBack={() => handleBackOneLevel('storage')}
          onRoot={() => handleGoToLocationRoot('storage')}
          onSelect={(entry) => handleSelectEntry('storage', entry)}
          onOpenFromEntry={(entry) => handleOpenEntry('storage', entry)}
          searchable
        />

        <BrowserPane
          title={
            <select
              className="pane-title-select"
              value={selectedWorkingLocationId || ''}
              onChange={(e) => setSelectedWorkingLocationId(e.target.value)}
              disabled={transferRunning}
            >
              {config.workingLocations.map((drive) => (
                <option key={drive.id} value={drive.id}>
                  {drive.name}
                  {drive.isPrimary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
          }
          currentPath={paths.working}
          rootPath={currentWorkingLocation?.rootPath || '/mnt/media'}
          entries={entries.working}
          selectedItem={selected.working}
          loading={loading.working}
          onRefresh={() =>
            loadLocationDirectory('working', paths.working, undefined, selectedWorkingLocationId)
          }
          onBack={() => handleBackOneLevel('working')}
          onRoot={() => handleGoToLocationRoot('working')}
          onSelect={(entry) => handleSelectEntry('working', entry)}
          onOpenFromEntry={(entry) => handleOpenEntry('working', entry)}
          searchable
        />
      </section>

      <section className="panel step-panel">
        <div className="panel-header">
          <div>
            <h3>Transfer Actions</h3>
            <p>Choose a source folder, compare the destination, then decide whether to replace or skip.</p>
          </div>
        </div>

        {notice.text ? (
          <div className="notice-slot">
            <div className={`result-banner ${notice.tone}`}>{notice.text}</div>
          </div>
        ) : null}

        <section className="grid two-col">
          <div className="subpanel">
            <h4>Restore (Storage → {currentWorkingLocation?.name || 'Working'})</h4>
            <p>Destination folder will be created in the current Working Location location.</p>
            <button
              className="button-primary"
              onClick={() => handleCompareTransfer('restore')}
              disabled={!canRestore || Boolean(comparingType) || transferRunning}
            >
              {comparingType === 'restore' ? 'Comparing…' : 'Compare Restore'}
            </button>
          </div>

          <div className="subpanel">
            <h4>Backup ({currentWorkingLocation?.name || 'Working'} → Storage)</h4>
            <p>Destination folder will be created in the current Storage Location location.</p>
            <button
              className="button-primary"
              onClick={() => handleCompareTransfer('backup')}
              disabled={!canBackup || Boolean(comparingType) || transferRunning}
            >
              {comparingType === 'backup' ? 'Comparing…' : 'Compare Backup'}
            </button>
          </div>
        </section>

        {compareState.result ? (
          <section className="subpanel" style={{ marginTop: 16 }} ref={compareActionsRef}>
            <h4>
              {compareState.type === 'restore'
                ? 'Restore Comparison Details'
                : 'Backup Comparison Details'}
            </h4>

            <p>
              <strong>Source:</strong>{' '}
              {getReadableLocationPreserveNames(
                compareState.source?.item?.path,
                compareState.source?.side === 'storage'
                  ? config.storageLocation.rootPath
                  : currentWorkingLocation?.rootPath || '/mnt/media'
              )}
            </p>
            <p>
              <strong>Destination:</strong>{' '}
              {getReadableLocationPreserveNames(
                compareState.destinationPath,
                compareState.destination?.side === 'storage'
                  ? config.storageLocation.rootPath
                  : currentWorkingLocation?.rootPath || '/mnt/media'
              )}
            </p>

            <section className="grid two-col" style={{ marginTop: 12 }}>
              <div>
                <h4 className="compare-heading">
                  Source
                  <span className={`compare-flag ${compareFreshness.source}`}>
                    {getFreshnessLabel(compareFreshness.source)}
                  </span>
                </h4>
                <p><strong>Exists:</strong> {compareState.result.source?.exists ? 'Yes' : 'No'}</p>
                <p><strong>Size:</strong> {formatBytes(compareState.result.source?.sizeBytes)}</p>
                <p><strong>Modified:</strong> {formatEpoch(compareState.result.source?.modifiedEpoch)}</p>
              </div>

              <div>
                <h4 className="compare-heading">
                  Destination
                  <span className={`compare-flag ${compareFreshness.destination}`}>
                    {getFreshnessLabel(compareFreshness.destination)}
                  </span>
                </h4>
                <p><strong>Exists:</strong> {compareState.result.destination?.exists ? 'Yes' : 'No'}</p>
                <p><strong>Size:</strong> {formatBytes(compareState.result.destination?.sizeBytes)}</p>
                <p><strong>Modified:</strong> {formatEpoch(compareState.result.destination?.modifiedEpoch)}</p>
              </div>
            </section>

            {destinationIsNewerWarning ? (
              <div className="compare-warning-row">
                <span className="compare-flag destination-newer">Destination Is Newer</span>
              </div>
            ) : null}

            <div className="button-row" style={{ marginTop: 16 }}>
              {compareState.result.destination?.exists ? (
                <>
                  <button
                    className="button-primary"
                    onClick={() => handleStartTransfer('replace')}
                    disabled={transferRunning}
                  >
                    {transferRunning ? 'Transferring…' : 'Replace Destination'}
                  </button>
                  <button onClick={() => handleStartTransfer('skip')} disabled={transferRunning}>
                    Skip
                  </button>
                </>
              ) : (
                <button
                  className="button-primary"
                  onClick={() => handleStartTransfer('skip')}
                  disabled={transferRunning}
                >
                  {transferRunning ? 'Transferring…' : 'Transfer Now'}
                </button>
              )}
            </div>
          </section>
        ) : null}

        {transferRunning || transferLogs ? (
          <section className="subpanel" style={{ marginTop: 16 }} ref={transferDetailsRef}>
            <h4>Transfer Details</h4>

            {transferRunning ? (
              <div className="transfer-progress-wrap">
                <div className="transfer-progress-label">
                  {transferProgress.phase === 'applying-permissions'
                    ? 'Applying permissions…'
                    : 'Transfer in progress…'}
                </div>

                <div className="progress-track">
                  <div
                    className={`progress-bar${Number(transferProgress.percent || 0) <= 0 ? ' indeterminate' : ''}`}
                    style={{
                      width:
                        Number(transferProgress.percent || 0) <= 0
                          ? '35%'
                          : `${Math.max(2, Math.min(100, transferProgress.percent || 0))}%`
                    }}
                  />
                </div>

                <div className="progress-meta">
                  <span>{transferProgress.percent || 0}%</span>
                  <span>{formatBytes(transferProgress.transferredBytes)}</span>
                  <span>{transferProgress.speedText || '—'}</span>
                  <span>{transferProgress.etaText ? `ETA ${transferProgress.etaText}` : '—'}</span>
                </div>
              </div>
            ) : null}

            <section className="grid two-col" style={{ marginTop: 12 }}>
              <div>
                <p><strong>Type:</strong> {transferLogs?.type === 'restore' ? 'Restore' : 'Backup'}</p>
                <p><strong>Status:</strong> {toTitleCase(transferLogs?.state || (transferRunning ? 'running' : 'completed'))}</p>
                <p><strong>Phase:</strong> {toTitleCase(transferLogs?.phase || transferProgress.phase || 'completed')}</p>
              </div>

              <div>
                <p><strong>Progress:</strong> {transferRunning ? transferProgress.percent || 0 : transferLogs?.progress?.percent ?? 100}%</p>
                <p><strong>Transferred:</strong> {formatBytes(transferRunning ? transferProgress.transferredBytes || 0 : transferLogs?.progress?.transferredBytes || 0)}</p>
                <p><strong>Average Speed:</strong> {transferRunning ? transferProgress.speedText || '—' : transferLogs?.progress?.speedText || '—'}</p>
              </div>
            </section>

            {transferLogs?.result?.destinationPath ? (
              <p style={{ marginTop: 12 }}>
                <strong>Destination:</strong> {formatTransferDestination(transferLogs.result.destinationPath)}
              </p>
            ) : null}

            <details style={{ marginTop: 16 }}>
              <summary>Raw Transfer Log</summary>
              <pre className="log-box">
{(transferLogs?.logs || []).join('\n')}
              </pre>
            </details>
          </section>
        ) : null}
      </section>
    </section>
  );
}

function BrowserPane({
  title,
  currentPath,
  rootPath,
  entries,
  selectedItem,
  loading,
  onRefresh,
  onBack,
  onRoot,
  onSelect,
  onOpenFromEntry,
  searchable = false
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredEntries = useMemo(() => {
    if (!normalizedSearch) return entries;
    return entries.filter((entry) => String(entry.name || '').toLowerCase().includes(normalizedSearch));
  }, [entries, normalizedSearch]);

  return (
    <section className="panel step-panel">
      <div className="panel-header pane-header-align-top">
        <div className="pane-header-title">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
        </div>
        <div className="pane-actions">
          <button
            className="pane-action-button"
            onClick={onBack}
            disabled={currentPath === rootPath || loading}
            title="Back"
            aria-label="Back"
          >
            <CaretCircleLeft size={20} weight="duotone" aria-hidden="true" />
          </button>
          <button
            className="pane-action-button"
            onClick={onRoot}
            disabled={currentPath === rootPath || loading}
            title="Root"
            aria-label="Root"
          >
            /
          </button>
          <button
            className="pane-action-button pane-action-refresh button-primary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
          >
            <ArrowsClockwise size={20} weight="duotone" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="subpanel browse-summary" style={{ marginBottom: 16 }}>
        <div className="browse-summary-row">
          <p style={{ margin: 0 }}><strong>Location:</strong> {getReadableLocation(currentPath, rootPath)}</p>
          {currentPath === rootPath ? (
            <span className="status-pill pending">At Root Location</span>
          ) : null}
        </div>
        <p><strong>Selected:</strong> {selectedItem?.name || 'None'}</p>
        <p className={selectedItem ? 'selection-hint hidden' : 'selection-hint'}>
          <em>No folder selected, will transfer to the location root</em>
        </p>
      </div>

      {searchable ? (
        <div className="entry-search-row">
          <div className="entry-search-input-wrap">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search folders..."
            />
            {searchTerm ? (
              <button
                type="button"
                className="entry-search-clear"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search"
                title="Clear"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <EntryList
        entries={filteredEntries}
        selectedEntry={selectedItem}
        onSelect={onSelect}
        onOpenFromEntry={onOpenFromEntry}
        emptyText={searchable && normalizedSearch ? 'No matching folders.' : 'No entries found in this folder.'}
      />
    </section>
  );
}

function EntryList({ entries, selectedEntry, onSelect, onOpenFromEntry, emptyText }) {
  if (!entries.length) {
    return <p>{emptyText}</p>;
  }

  const hasOverflow = entries.length > 10;

  return (
    <div className={hasOverflow ? 'entry-list-container has-overflow' : 'entry-list-container'}>
      <ul className="entry-list">
        {entries.map((entry) => {
          const isSelected =
            selectedEntry?.name === entry.name && selectedEntry?.kind === entry.kind;

          return (
            <li key={`${entry.kind}-${entry.name}`}>
              <button
                className={isSelected ? 'entry-button selected' : 'entry-button'}
                onClick={() => onSelect(entry)}
                onDoubleClick={() => {
                  onSelect(entry);
                  if (entry.kind === 'directory') {
                    onOpenFromEntry(entry);
                  }
                }}
              >
                <span className="entry-kind-icon" aria-hidden="true">
                  {entry.kind === 'directory' ? (
                    <FolderSimple size={18} weight="duotone" />
                  ) : (
                    <File size={18} weight="duotone" />
                  )}
                </span>
                <span>{entry.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {hasOverflow ? <div className="entry-scroll-hint">Scroll for more</div> : null}
    </div>
  );
}
