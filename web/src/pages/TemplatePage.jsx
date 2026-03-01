import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, CaretCircleLeft, File, FolderSimple, PlusCircle, Trash, XCircle } from '@phosphor-icons/react';
import { api } from '../lib/api.js';

const DEFAULT_PROJECT_TYPES = ['POD', 'PIC', 'RAD', 'ADR', 'IVR', 'VO', 'AB', 'SFX', 'MTR', 'MIX'];

const TOKEN_TYPES = {
  CLIENT_NAME: 'client_name',
  PROJECT_NAME: 'project_name',
  PROJECT_TYPE: 'project_type',
  DATE_YYYYMMDD: 'date_yyyymmdd',
  DATE_DDMMYYYY_DOTS: 'date_ddmmyyyy_dots',
  SPACE: 'space',
  UNDERSCORE: 'underscore',
  DASH: 'dash',
  CUSTOM: 'custom'
};

const DATE_TOKEN_TYPES = [TOKEN_TYPES.DATE_YYYYMMDD, TOKEN_TYPES.DATE_DDMMYYYY_DOTS];

const SCHEME_BLOCKS = [
  { type: TOKEN_TYPES.CLIENT_NAME, label: 'Client Name' },
  { type: TOKEN_TYPES.PROJECT_NAME, label: 'Project Name' },
  { type: TOKEN_TYPES.PROJECT_TYPE, label: 'Project Type' },
  { type: TOKEN_TYPES.DATE_YYYYMMDD, label: 'Date (Free Field)' },
  { type: TOKEN_TYPES.DATE_DDMMYYYY_DOTS, label: 'Date (DD.MM.YYYY)' },
  { type: TOKEN_TYPES.SPACE, label: 'Space' },
  { type: TOKEN_TYPES.UNDERSCORE, label: 'Underscore' },
  { type: TOKEN_TYPES.DASH, label: 'Dash' },
  { type: TOKEN_TYPES.CUSTOM, label: 'Custom Text' }
];

const defaultConfig = {
  storageLocation: {
    host: '',
    port: 22,
    username: '',
    rootPath: '/var/nfs/shared/Sessions',
    templateDirectoryPath: '/var/nfs/shared/Sessions'
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

function makeSchemeItem(type, customValue = '') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    value: type === TOKEN_TYPES.CUSTOM ? customValue : ''
  };
}

function toStoredScheme(scheme) {
  return scheme.map((item) => ({ type: item.type, value: item.value || '' }));
}

function fromStoredScheme(storedScheme) {
  if (!Array.isArray(storedScheme) || !storedScheme.length) return getDefaultScheme();
  return storedScheme.map((token) => makeSchemeItem(token.type, token.value || ''));
}

function getDefaultScheme() {
  return [
    makeSchemeItem(TOKEN_TYPES.CLIENT_NAME),
    makeSchemeItem(TOKEN_TYPES.SPACE),
    makeSchemeItem(TOKEN_TYPES.PROJECT_NAME),
    makeSchemeItem(TOKEN_TYPES.UNDERSCORE),
    makeSchemeItem(TOKEN_TYPES.PROJECT_TYPE),
    makeSchemeItem(TOKEN_TYPES.UNDERSCORE),
    makeSchemeItem(TOKEN_TYPES.DATE_YYYYMMDD)
  ];
}

function getTodayISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayYYYYMMDD() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function normalizeConfig(config) {
  const storageLocation = {
    host: config?.storageLocation?.host || '',
    port: Number(config?.storageLocation?.port || 22),
    username: config?.storageLocation?.username || '',
    rootPath: config?.storageLocation?.rootPath || '/var/nfs/shared/Sessions',
    templateDirectoryPath:
      config?.storageLocation?.templateDirectoryPath ||
      config?.storageLocation?.rootPath ||
      '/var/nfs/shared/Sessions'
  };

  let workingLocations = Array.isArray(config?.workingLocations) && config.workingLocations.length
    ? config.workingLocations.map((location, index) => ({
        id: location.id || `working-${index + 1}`,
        name: location.name || `Working Location ${index + 1}`,
        host: location.host || '',
        port: Number(location.port || 22),
        username: location.username || '',
        rootPath: location.rootPath || '/mnt/media',
        isPrimary: Boolean(location.isPrimary),
        setupState: {
          containerAuthorized: Boolean(location?.setupState?.containerAuthorized),
          storageToWorking: Boolean(location?.setupState?.storageToWorking),
          workingToStorage: Boolean(location?.setupState?.workingToStorage)
        }
      }))
    : [...defaultConfig.workingLocations];

  if (!workingLocations.some((location) => location.isPrimary)) {
    workingLocations = workingLocations.map((location, index) => ({
      ...location,
      isPrimary: index === 0
    }));
  }

  const selectedWorkingLocationId =
    config?.selectedWorkingLocationId ||
    workingLocations.find((location) => location.isPrimary)?.id ||
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
  const storageReady =
    hasConfiguredTarget(config?.storageLocation) &&
    Boolean(config?.storageLocation?.templateDirectoryPath?.trim());
  const working =
    config?.workingLocations?.find((location) => location.id === selectedWorkingLocationId) ||
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
    throw new Error(`${side === 'storage' ? 'Template source' : 'Working location'} host is not configured. Ask an admin to complete setup.`);
  }
  if (!target?.username?.trim()) {
    throw new Error(`${side === 'storage' ? 'Template source' : 'Working location'} username is not configured. Ask an admin to complete setup.`);
  }
}

function getTokenLabel(item) {
  const found = SCHEME_BLOCKS.find((block) => block.type === item.type);
  return found ? found.label : item.type;
}

function parseDateValue(value) {
  const text = String(value || '').trim();

  if (/^\d{8}$/.test(text)) {
    return {
      year: text.slice(0, 4),
      month: text.slice(4, 6),
      day: text.slice(6, 8)
    };
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return {
      year: isoMatch[1],
      month: isoMatch[2],
      day: isoMatch[3]
    };
  }

  const dotMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) {
    return {
      year: dotMatch[3],
      month: dotMatch[2],
      day: dotMatch[1]
    };
  }

  return null;
}

function formatDateValue(parts, tokenType) {
  if (!parts) return '';
  if (tokenType === TOKEN_TYPES.DATE_DDMMYYYY_DOTS) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  return `${parts.year}${parts.month}${parts.day}`;
}

function buildSchemeExample(scheme) {
  return scheme
    .map((item) => {
      switch (item.type) {
        case TOKEN_TYPES.CLIENT_NAME:
          return 'Client Name';
        case TOKEN_TYPES.PROJECT_NAME:
          return 'Project Name';
        case TOKEN_TYPES.PROJECT_TYPE:
          return 'Project Type';
        case TOKEN_TYPES.DATE_YYYYMMDD:
        case TOKEN_TYPES.DATE_DDMMYYYY_DOTS:
          return 'Date';
        case TOKEN_TYPES.SPACE:
          return ' ';
        case TOKEN_TYPES.UNDERSCORE:
          return '_';
        case TOKEN_TYPES.DASH:
          return '-';
        case TOKEN_TYPES.CUSTOM:
          return item.value || 'Custom';
        default:
          return '';
      }
    })
    .join('');
}

export default function TemplatePage() {
  const createActionsRef = useRef(null);
  const [config, setConfig] = useState(defaultConfig);
  const [rawConfig, setRawConfig] = useState({});
  const [selectedWorkingLocationId, setSelectedWorkingLocationId] = useState(
    defaultConfig.selectedWorkingLocationId
  );
  const [loadingConfig, setLoadingConfig] = useState(true);

  const [paths, setPaths] = useState({
    storage: defaultConfig.storageLocation.templateDirectoryPath,
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

  const [naming, setNaming] = useState({
    clientName: '',
    projectName: '',
    projectType: 'PIC',
    date: getTodayYYYYMMDD()
  });
  const [projectTypes, setProjectTypes] = useState(DEFAULT_PROJECT_TYPES);
  const [showProjectTypesModal, setShowProjectTypesModal] = useState(false);
  const [projectTypeInput, setProjectTypeInput] = useState('');
  const [scheme, setScheme] = useState(getDefaultScheme);
  const [draggingSchemeId, setDraggingSchemeId] = useState(null);
  const [draggingBlockType, setDraggingBlockType] = useState('');
  const [dragOverSchemeIndex, setDragOverSchemeIndex] = useState(null);
  const [schemeNameInput, setSchemeNameInput] = useState('');
  const [savedSchemes, setSavedSchemes] = useState([]);
  const [selectedSavedSchemeId, setSelectedSavedSchemeId] = useState('');
  const [defaultSchemeId, setDefaultSchemeId] = useState('');
  const [showSchemesModal, setShowSchemesModal] = useState(false);
  const [preview, setPreview] = useState({
    loading: false,
    sessionName: '',
    error: ''
  });

  const [notice, setNotice] = useState({
    tone: 'pending',
    text: ''
  });
  const [namingNotice, setNamingNotice] = useState({
    tone: 'pending',
    text: ''
  });
  const [comparing, setComparing] = useState(false);
  const [creating, setCreating] = useState(false);

  const [compareState, setCompareState] = useState({
    source: null,
    destinationPath: '',
    result: null,
    ptxInfo: null
  });

  const currentWorkingLocation = useMemo(
    () =>
      config.workingLocations.find((location) => location.id === selectedWorkingLocationId) ||
      config.workingLocations[0] ||
      null,
    [config.workingLocations, selectedWorkingLocationId]
  );
  const setupComplete = useMemo(
    () => isSetupComplete(config, selectedWorkingLocationId),
    [config, selectedWorkingLocationId]
  );

  const selectedDateTokenType = useMemo(
    () => scheme.find((item) => DATE_TOKEN_TYPES.includes(item.type))?.type || null,
    [scheme]
  );

  const schemeExample = useMemo(() => buildSchemeExample(scheme), [scheme]);
  const activeScheme = useMemo(() => {
    const current = JSON.stringify(toStoredScheme(scheme));
    return savedSchemes.find((item) => JSON.stringify(item.scheme || []) === current) || null;
  }, [savedSchemes, scheme]);

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      try {
        const loadedConfig = await api.getConfig();
        if (!active) return;
        setRawConfig(loadedConfig || {});

        const normalized = normalizeConfig(loadedConfig);
        const initialWorkingLocation =
          normalized.workingLocations.find(
            (location) => location.id === normalized.selectedWorkingLocationId
          ) ||
          normalized.workingLocations[0] ||
          null;

        setConfig(normalized);
        setSelectedWorkingLocationId(normalized.selectedWorkingLocationId);

        const loadedSchemes = Array.isArray(loadedConfig?.templateNaming?.schemes)
          ? loadedConfig.templateNaming.schemes
          : [];
        const loadedProjectTypes = Array.isArray(loadedConfig?.templateNaming?.projectTypes)
          ? loadedConfig.templateNaming.projectTypes
              .map((item) => String(item || '').trim())
              .filter(Boolean)
          : [];
        const loadedDefaultSchemeId = loadedConfig?.templateNaming?.defaultSchemeId || '';
        const effectiveProjectTypes = loadedProjectTypes.length ? loadedProjectTypes : DEFAULT_PROJECT_TYPES;

        setSavedSchemes(loadedSchemes);
        setProjectTypes(effectiveProjectTypes);
        setDefaultSchemeId(loadedDefaultSchemeId);
        setSelectedSavedSchemeId(loadedDefaultSchemeId || loadedSchemes[0]?.id || '');
        setNaming((current) => ({
          ...current,
          projectType: effectiveProjectTypes.includes(current.projectType)
            ? current.projectType
            : effectiveProjectTypes[0] || 'PIC'
        }));

        const defaultPreset = loadedSchemes.find((item) => item.id === loadedDefaultSchemeId);
        if (defaultPreset?.scheme) {
          setScheme(fromStoredScheme(defaultPreset.scheme));
        }

        const initialPaths = {
          storage: normalized.storageLocation.templateDirectoryPath,
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
        setNotice({ tone: 'error', text: `Failed to load template page: ${error.message}` });
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
    if (loadingConfig || !currentWorkingLocation || !setupComplete) return;

    const nextWorkingPath = currentWorkingLocation.rootPath;
    setPaths((current) => ({ ...current, working: nextWorkingPath }));
    setSelected((current) => ({ ...current, working: null }));
    loadLocationDirectory('working', nextWorkingPath, undefined, currentWorkingLocation.id);
  }, [loadingConfig, currentWorkingLocation?.id, setupComplete]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      if (!hasRequiredNamingInputs()) {
        if (!active) return;
        setPreview({ loading: false, sessionName: '', error: '' });
        return;
      }

      try {
        if (!active) return;
        setPreview((current) => ({ ...current, loading: true, error: '' }));
        const result = await api.previewName({
          ...naming,
          scheme: scheme.map((item) => ({ type: item.type, value: item.value || '' }))
        });
        if (!active) return;
        setPreview({
          loading: false,
          sessionName: result.sessionName || '',
          error: ''
        });
      } catch (error) {
        if (!active) return;
        setPreview({
          loading: false,
          sessionName: '',
          error: error.message
        });
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [naming.clientName, naming.projectName, naming.projectType, naming.date, scheme]);

  useEffect(() => {
    if (!projectTypes.length) return;
    if (!projectTypes.includes(naming.projectType)) {
      setNaming((current) => ({
        ...current,
        projectType: projectTypes[0]
      }));
    }
  }, [projectTypes, naming.projectType]);

  useEffect(() => {
    setCompareState({
      source: null,
      destinationPath: '',
      result: null,
      ptxInfo: null
    });
  }, [
    selected.storage?.path,
    paths.working,
    selectedWorkingLocationId,
    naming.clientName,
    naming.projectName,
    naming.projectType,
    naming.date,
    scheme
  ]);

  async function loadLocationDirectory(side, explicitPath, overrideConfig, overrideWorkingLocationId) {
    const activeConfig = overrideConfig || config;

    let target;
    if (side === 'storage') {
      target = activeConfig.storageLocation;
    } else {
      const workingLocationId =
        overrideWorkingLocationId ||
        overrideConfig?.selectedWorkingLocationId ||
        selectedWorkingLocationId;
      target =
        activeConfig.workingLocations.find((location) => location.id === workingLocationId) ||
        activeConfig.workingLocations[0] ||
        null;
    }

    const path =
      explicitPath ||
      (side === 'storage'
        ? activeConfig.storageLocation.templateDirectoryPath
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

      let sorted = [...(result.entries || [])].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      if (side === 'storage') {
        sorted = sorted.filter((entry) => entry.kind === 'directory');
      }

      setEntries((current) => ({ ...current, [side]: sorted }));
      setPaths((current) => ({ ...current, [side]: path }));
      setSelected((current) => ({ ...current, [side]: null }));
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `Failed to load ${side === 'storage' ? 'template source' : 'working location'}: ${error.message}`
      });
      setEntries((current) => ({ ...current, [side]: [] }));
    } finally {
      setLoading((current) => ({ ...current, [side]: false }));
    }
  }

  function handleSelectEntry(side, entry) {
    if (side === 'storage' && entry.kind !== 'directory') return;
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
        ? config.storageLocation.templateDirectoryPath
        : currentWorkingLocation?.rootPath || '/mnt/media';
    const nextPath = getParentPath(paths[side], rootPath);
    await loadLocationDirectory(side, nextPath, undefined, selectedWorkingLocationId);
  }

  async function handleGoToLocationRoot(side) {
    const rootPath =
      side === 'storage'
        ? config.storageLocation.templateDirectoryPath
        : currentWorkingLocation?.rootPath || '/mnt/media';
    await loadLocationDirectory(side, rootPath, undefined, selectedWorkingLocationId);
  }

  function updateNaming(field, value) {
    setNaming((current) => ({
      ...current,
      [field]: value
    }));
  }

  function hasToken(type) {
    return scheme.some((item) => item.type === type);
  }

  function hasRequiredNamingInputs() {
    if (hasToken(TOKEN_TYPES.CLIENT_NAME) && !naming.clientName.trim()) return false;
    if (hasToken(TOKEN_TYPES.PROJECT_NAME) && !naming.projectName.trim()) return false;
    if (selectedDateTokenType && !naming.date.trim()) return false;
    return true;
  }

  function insertSchemeBlockAt(type, targetIndex = null) {
    const normalizeIndex = (length) => {
      if (typeof targetIndex !== 'number' || Number.isNaN(targetIndex)) return length;
      return Math.max(0, Math.min(targetIndex, length));
    };

    if (DATE_TOKEN_TYPES.includes(type)) {
      const parsed = parseDateValue(naming.date);
      const nextDateValue = parsed ? formatDateValue(parsed, type) : type === TOKEN_TYPES.DATE_DDMMYYYY_DOTS ? getTodayISODate() : getTodayYYYYMMDD();

      setNaming((current) => ({
        ...current,
        date: nextDateValue
      }));

      setScheme((current) => {
        const insertionIndex = normalizeIndex(current.length);
        const existingDateIndex = current.findIndex((item) => DATE_TOKEN_TYPES.includes(item.type));
        if (existingDateIndex >= 0) {
          return current.map((item, index) =>
            index === existingDateIndex ? { ...item, type } : item
          );
        }
        const next = [...current];
        next.splice(insertionIndex, 0, makeSchemeItem(type));
        return next;
      });
      return;
    }

    setScheme((current) => {
      const insertionIndex = normalizeIndex(current.length);
      const next = [...current];
      next.splice(insertionIndex, 0, makeSchemeItem(type, type === TOKEN_TYPES.CUSTOM ? ' ' : ''));
      return next;
    });
  }

  function addSchemeBlock(type) {
    insertSchemeBlockAt(type);
  }

  async function persistTemplateNaming(nextTemplateNaming) {
    const payload = {
      ...rawConfig,
      storageLocation: config.storageLocation,
      workingLocations: config.workingLocations,
      selectedWorkingLocationId: selectedWorkingLocationId,
      templateNaming: nextTemplateNaming
    };

    const result = await api.saveConfig(payload);
    setRawConfig(result.config || payload);
  }

  async function handleSaveScheme() {
    try {
      const name = schemeNameInput.trim();
      if (!name) throw new Error('Scheme name is required');
      if (!scheme.length) throw new Error('Add at least one scheme block');

      const existing = savedSchemes.find(
        (item) => item.name.toLowerCase() === name.toLowerCase()
      );

      const nextScheme = {
        id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        scheme: toStoredScheme(scheme)
      };

      const nextSchemes = existing
        ? savedSchemes.map((item) => (item.id === existing.id ? nextScheme : item))
        : [...savedSchemes, nextScheme];

      const nextTemplateNaming = {
        defaultSchemeId,
        schemes: nextSchemes,
        projectTypes
      };

      await persistTemplateNaming(nextTemplateNaming);
      setSavedSchemes(nextSchemes);
      setSelectedSavedSchemeId(nextScheme.id);
      setSchemeNameInput(name);
      setNamingNotice({ tone: 'success', text: `Saved naming scheme "${name}".` });
    } catch (error) {
      setNamingNotice({ tone: 'error', text: `Save scheme failed: ${error.message}` });
    }
  }

  function handleLoadSelectedScheme() {
    const selectedPreset = savedSchemes.find((item) => item.id === selectedSavedSchemeId);
    if (!selectedPreset) return;
    setScheme(fromStoredScheme(selectedPreset.scheme));
    setSchemeNameInput(selectedPreset.name);
    setNamingNotice({ tone: 'success', text: `Loaded naming scheme "${selectedPreset.name}".` });
  }

  async function handleSetDefaultScheme() {
    try {
      const selectedPreset = savedSchemes.find((item) => item.id === selectedSavedSchemeId);
      if (!selectedPreset) throw new Error('Choose a saved scheme first');

      const nextTemplateNaming = {
        defaultSchemeId: selectedPreset.id,
        schemes: savedSchemes,
        projectTypes
      };

      await persistTemplateNaming(nextTemplateNaming);
      setDefaultSchemeId(selectedPreset.id);
      setNamingNotice({ tone: 'success', text: `"${selectedPreset.name}" set as default scheme.` });
    } catch (error) {
      setNamingNotice({ tone: 'error', text: `Set default failed: ${error.message}` });
    }
  }

  function updateCustomBlock(id, value) {
    setScheme((current) =>
      current.map((item) => (item.id === id ? { ...item, value } : item))
    );
  }

  function removeSchemeBlock(id) {
    setScheme((current) => current.filter((item) => item.id !== id));
  }

  function moveSchemeBlockToIndex(draggedId, targetIndex) {
    if (!draggedId) return;

    setScheme((current) => {
      const fromIndex = current.findIndex((item) => item.id === draggedId);
      if (fromIndex < 0) return current;

      let insertionIndex = Math.max(0, Math.min(targetIndex, current.length));
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (fromIndex < insertionIndex) insertionIndex -= 1;
      insertionIndex = Math.max(0, Math.min(insertionIndex, next.length));
      next.splice(insertionIndex, 0, moved);
      return next;
    });
  }

  async function handleSaveProjectTypes(nextProjectTypes) {
    const sanitized = nextProjectTypes
      .map((type) => String(type || '').trim().toUpperCase())
      .filter(Boolean);
    const unique = [...new Set(sanitized)];
    if (!unique.length) throw new Error('Keep at least one project type');

    const nextTemplateNaming = {
      defaultSchemeId,
      schemes: savedSchemes,
      projectTypes: unique
    };

    await persistTemplateNaming(nextTemplateNaming);
    setProjectTypes(unique);
    setNaming((current) => ({
      ...current,
      projectType: unique.includes(current.projectType) ? current.projectType : unique[0]
    }));
  }

  async function handleAddProjectType() {
    try {
      const value = String(projectTypeInput || '').trim().toUpperCase();
      if (!value) throw new Error('Project type is required');
      if (projectTypes.includes(value)) throw new Error('Project type already exists');

      const next = [...projectTypes, value];
      await handleSaveProjectTypes(next);
      setProjectTypeInput('');
      setNamingNotice({ tone: 'success', text: `Added project type "${value}".` });
    } catch (error) {
      setNamingNotice({ tone: 'error', text: `Add project type failed: ${error.message}` });
    }
  }

  async function handleRemoveProjectType(typeToRemove) {
    try {
      if (projectTypes.length <= 1) {
        throw new Error('At least one project type is required');
      }
      const next = projectTypes.filter((type) => type !== typeToRemove);
      await handleSaveProjectTypes(next);
      setNamingNotice({ tone: 'success', text: `Removed project type "${typeToRemove}".` });
    } catch (error) {
      setNamingNotice({ tone: 'error', text: `Remove project type failed: ${error.message}` });
    }
  }

  async function handleCompare() {
    try {
      setComparing(true);
      setNotice((current) => ({ ...current, text: '' }));

      if (!selected.storage || selected.storage.kind !== 'directory') {
        throw new Error('Select a template folder in Template Source first');
      }

      const previewResult = await api.previewName({
        ...naming,
        scheme: scheme.map((item) => ({ type: item.type, value: item.value || '' }))
      });
      const destinationPath = joinRemotePath(paths.working, previewResult.sessionName);

      const [result, ptxInfo] = await Promise.all([
        api.compareTransfer({
          sourceTarget: {
            host: config.storageLocation.host,
            port: config.storageLocation.port,
            username: config.storageLocation.username
          },
          sourcePath: selected.storage.path,
          destinationTarget: {
            host: currentWorkingLocation.host,
            port: currentWorkingLocation.port,
            username: currentWorkingLocation.username
          },
          destinationPath
        }),
        api.checkTemplatePtx({
          storageTarget: {
            host: config.storageLocation.host,
            port: config.storageLocation.port,
            username: config.storageLocation.username
          },
          templatePath: selected.storage.path
        })
      ]);

      setPreview((current) => ({
        ...current,
        sessionName: previewResult.sessionName
      }));

      setCompareState({
        source: selected.storage,
        destinationPath,
        result,
        ptxInfo
      });

      setTimeout(() => {
        createActionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `Compare failed: ${error.message}`
      });
      setCompareState({
        source: null,
        destinationPath: '',
        result: null,
        ptxInfo: null
      });
    } finally {
      setComparing(false);
    }
  }

  async function handleCreate(existingMode) {
    try {
      if (!compareState.result) {
        throw new Error('Run Check first');
      }

      if (compareState.result.destination?.exists && existingMode === 'skip') {
        setNotice({
          tone: 'pending',
          text: 'Create skipped.'
        });
        setCompareState({
          source: null,
          destinationPath: '',
          result: null,
          ptxInfo: null
        });
        return;
      }

      setCreating(true);
      setNotice((current) => ({ ...current, text: '' }));

      const result = await api.createFromTemplate({
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
        templatePath: compareState.source.path,
        destinationParent: paths.working,
        destinationRootPath: currentWorkingLocation.rootPath,
        clientName: naming.clientName,
        projectName: naming.projectName,
        projectType: naming.projectType,
        date: naming.date,
        scheme: scheme.map((item) => ({ type: item.type, value: item.value || '' })),
        existingMode
      });

      const noPtxFound = result?.ptxStatus === 'no_ptx_found';
      setNotice(
        noPtxFound
          ? {
              tone: 'pending',
              text: `Created ${result.sessionName} in working location, but no .ptx file was found in the copied template.`
            }
          : {
              tone: 'success',
              text: `Created ${result.sessionName} in working location.`
            }
      );

      await loadLocationDirectory('working', paths.working, undefined, selectedWorkingLocationId);

      setCompareState({
        source: null,
        destinationPath: '',
        result: null,
        ptxInfo: null
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: `Create failed: ${error.message}`
      });
    } finally {
      setCreating(false);
    }
  }

  const canCompare = Boolean(
    selected.storage &&
      selected.storage.kind === 'directory' &&
      scheme.length &&
      hasRequiredNamingInputs()
  );

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
        <h2>Create New Session from Template</h2>
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
            <h2>Create New Session from Template</h2>
            <p>Choose a template source folder, check destination, then create.</p>
          </div>
        </div>

      </section>

      <section className="grid two-col">
        <BrowserPane
          title="Template Source"
          currentPath={paths.storage}
          rootPath={config.storageLocation.templateDirectoryPath}
          entries={entries.storage}
          selectedItem={selected.storage}
          loading={loading.storage}
          selectionHint="Select a template to use."
          showSelected={false}
          onRefresh={() => loadLocationDirectory('storage', paths.storage, undefined, selectedWorkingLocationId)}
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
              disabled={creating}
            >
              {config.workingLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {location.isPrimary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
          }
          currentPath={paths.working}
          rootPath={currentWorkingLocation?.rootPath || '/mnt/media'}
          entries={entries.working}
          selectedItem={selected.working}
          loading={loading.working}
          selectionHint="New session folder will be created in the current location path."
          showSelected={false}
          onRefresh={() => loadLocationDirectory('working', paths.working, undefined, selectedWorkingLocationId)}
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
            <h3>Session Name</h3>
          </div>
        </div>

        <div className="naming-top-grid">
          <section className="subpanel" style={{ marginTop: 8 }}>
            <div className="scheme-blocks-line">
              <p><strong>Blocks</strong></p>
              <div className="scheme-blocks">
              {SCHEME_BLOCKS.map((block) => (
                <button
                  key={block.type}
                  className="scheme-block-option"
                  onClick={() => addSchemeBlock(block.type)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', block.type);
                    setDraggingBlockType(block.type);
                  }}
                  onDragEnd={() => {
                    setDraggingBlockType('');
                    setDragOverSchemeIndex(null);
                  }}
                >
                  <PlusCircle size={16} weight="duotone" aria-hidden="true" />
                  {block.label}
                </button>
              ))}
              </div>
            </div>
          </section>

          <section className="subpanel" style={{ marginTop: 8 }}>
            {namingNotice.text ? (
              <div className={`result-banner ${namingNotice.tone}`} style={{ marginBottom: 10 }}>
                {namingNotice.text}
              </div>
            ) : null}
            <div className="scheme-manager-row">
              <div className="scheme-manager-text">
                <div className="scheme-manager-header">
                  <p><strong>Scheme Management</strong></p>
                </div>
                <p className="scheme-active-label">
                  <strong>Active Scheme:</strong> {activeScheme?.name || 'None'}
                </p>
                <button className="scheme-manage-button" onClick={() => setShowSchemesModal(true)}>
                  Saved Schemes
                </button>
              </div>
            </div>
          </section>
        </div>

        <section className="subpanel" style={{ marginTop: 16 }}>
          <div className="scheme-builder-header-row">
            <p><strong>Scheme Builder (drag to reorder)</strong></p>
            <button className="scheme-manage-button" onClick={() => setShowProjectTypesModal(true)}>
              Edit Project Types
            </button>
          </div>
          <p className="scheme-builder-example"><strong>Example:</strong> {schemeExample || '—'}</p>
          <div
            className={`scheme-builder-row${draggingSchemeId || draggingBlockType ? ' dragging' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const tokenType = e.dataTransfer.getData('text/plain');
              if (tokenType && SCHEME_BLOCKS.some((block) => block.type === tokenType)) {
                addSchemeBlock(tokenType);
              } else if (draggingSchemeId) {
                moveSchemeBlockToIndex(draggingSchemeId, scheme.length);
              }
              setDraggingBlockType('');
              setDragOverSchemeIndex(null);
            }}
          >
            {scheme.map((item, index) => (
              <Fragment key={item.id}>
                <div
                  className={`scheme-drop-slot${dragOverSchemeIndex === index ? ' active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverSchemeIndex(index);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const tokenType = e.dataTransfer.getData('text/plain');
                    if (tokenType && SCHEME_BLOCKS.some((block) => block.type === tokenType)) {
                      insertSchemeBlockAt(tokenType, index);
                    } else if (draggingSchemeId) {
                      moveSchemeBlockToIndex(draggingSchemeId, index);
                    }
                    setDraggingBlockType('');
                    setDragOverSchemeIndex(null);
                  }}
                />
                <div
                  className="scheme-item"
                  draggable
                  onDragStart={() => setDraggingSchemeId(item.id)}
                  onDragEnd={() => {
                    setDraggingSchemeId(null);
                    setDraggingBlockType('');
                    setDragOverSchemeIndex(null);
                  }}
                >
                  <span className="scheme-item-label">{getTokenLabel(item)}</span>
                  {item.type === TOKEN_TYPES.CLIENT_NAME ? (
                    <input
                      className="scheme-inline-input"
                      type="text"
                      value={naming.clientName}
                      onChange={(e) => updateNaming('clientName', e.target.value)}
                      placeholder="client name"
                    />
                  ) : null}
                  {item.type === TOKEN_TYPES.PROJECT_NAME ? (
                    <input
                      className="scheme-inline-input scheme-inline-input-project-name"
                      type="text"
                      value={naming.projectName}
                      onChange={(e) => updateNaming('projectName', e.target.value)}
                      placeholder="project name"
                    />
                  ) : null}
                  {item.type === TOKEN_TYPES.PROJECT_TYPE ? (
                    <select
                      className="scheme-inline-select scheme-inline-select-project-type"
                      value={naming.projectType}
                      onChange={(e) => updateNaming('projectType', e.target.value)}
                    >
                      {projectTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {DATE_TOKEN_TYPES.includes(item.type) ? (
                    <input
                      className="scheme-inline-input"
                      type={item.type === TOKEN_TYPES.DATE_DDMMYYYY_DOTS ? 'date' : 'text'}
                      inputMode={item.type === TOKEN_TYPES.DATE_DDMMYYYY_DOTS ? undefined : 'numeric'}
                      placeholder={item.type === TOKEN_TYPES.DATE_DDMMYYYY_DOTS ? undefined : 'YYYYMMDD'}
                      value={naming.date}
                      onChange={(e) => updateNaming('date', e.target.value)}
                    />
                  ) : null}
                  {item.type === TOKEN_TYPES.CUSTOM ? (
                    <input
                      className="scheme-custom-input"
                      type="text"
                      value={item.value}
                      onChange={(e) => updateCustomBlock(item.id, e.target.value)}
                      placeholder="custom text"
                    />
                  ) : null}
                  <button className="scheme-remove-button" onClick={() => removeSchemeBlock(item.id)}>
                    <XCircle size={16} weight="duotone" aria-hidden="true" />
                  </button>
                </div>
              </Fragment>
            ))}
            <div
              className={`scheme-drop-slot${dragOverSchemeIndex === scheme.length ? ' active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverSchemeIndex(scheme.length);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const tokenType = e.dataTransfer.getData('text/plain');
                if (tokenType && SCHEME_BLOCKS.some((block) => block.type === tokenType)) {
                  insertSchemeBlockAt(tokenType, scheme.length);
                } else if (draggingSchemeId) {
                  moveSchemeBlockToIndex(draggingSchemeId, scheme.length);
                }
                setDraggingBlockType('');
                setDragOverSchemeIndex(null);
              }}
            />
          </div>
        </section>

        <section className="subpanel" style={{ marginTop: 16 }}>
          <p className="template-generated-line">
            <strong>Generated Session Name:</strong>&nbsp;
            {preview.loading ? 'Generating…' : preview.sessionName || '—'}
          </p>
          {preview.error ? <p className="error-text">{preview.error}</p> : null}
        </section>
      </section>

      {showSchemesModal ? (
        <div className="scheme-modal-backdrop" onClick={() => setShowSchemesModal(false)}>
          <section className="scheme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Saved Schemes</h4>
              <button onClick={() => setShowSchemesModal(false)}>Close</button>
            </div>
            <div className="scheme-preset-row scheme-preset-row-compact" style={{ marginTop: 8 }}>
              <input
                type="text"
                value={schemeNameInput}
                onChange={(e) => setSchemeNameInput(e.target.value)}
                placeholder="Scheme name"
              />
              <button onClick={handleSaveScheme}>Save Scheme</button>
            </div>
            <div className="scheme-preset-row scheme-preset-row-compact" style={{ marginTop: 8 }}>
              <select
                value={selectedSavedSchemeId}
                onChange={(e) => setSelectedSavedSchemeId(e.target.value)}
              >
                <option value="">Select saved scheme</option>
                {savedSchemes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.id === defaultSchemeId ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              <button onClick={handleLoadSelectedScheme} disabled={!selectedSavedSchemeId}>
                Load Selected
              </button>
              <button onClick={handleSetDefaultScheme} disabled={!selectedSavedSchemeId}>
                Set Default
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showProjectTypesModal ? (
        <div className="scheme-modal-backdrop" onClick={() => setShowProjectTypesModal(false)}>
          <section className="scheme-modal project-types-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Edit Project Types</h4>
              <button onClick={() => setShowProjectTypesModal(false)}>Close</button>
            </div>

            <section className="project-types-add-row">
              <input
                type="text"
                value={projectTypeInput}
                onChange={(e) => setProjectTypeInput(e.target.value)}
                placeholder="New project type"
              />
              <button
                className="setup-icon-button"
                title="Add Project Type"
                aria-label="Add Project Type"
                onClick={handleAddProjectType}
              >
                <PlusCircle size={18} weight="duotone" aria-hidden="true" />
              </button>
            </section>

            <section className="project-types-list">
              {projectTypes.map((type) => (
                <div key={type} className="project-types-item">
                  <strong>{type}</strong>
                  <button
                    className="setup-icon-button setup-icon-button-danger"
                    title="Remove Project Type"
                    aria-label={`Remove ${type}`}
                    onClick={() => handleRemoveProjectType(type)}
                  >
                    <Trash size={18} weight="duotone" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </section>
          </section>
        </div>
      ) : null}

      <section className="panel step-panel">
        <div className="panel-header">
          <div>
            <h3>Create</h3>
            <p>Compare destination status before creating from template.</p>
          </div>
          <button
            className="button-primary"
            onClick={handleCompare}
            disabled={!canCompare || comparing || creating}
          >
            {comparing ? 'Checking…' : 'Check'}
          </button>
        </div>

        {notice.text ? (
          <div className="notice-slot">
            <div className={`result-banner ${notice.tone}`}>{notice.text}</div>
          </div>
        ) : null}

        {compareState.result ? (
          <section className="subpanel" style={{ marginTop: 16 }} ref={createActionsRef}>
            <h4>New Session Creation Details</h4>
            <p>
              <strong>Source:</strong>{' '}
              {getReadableLocationPreserveNames(
                compareState.source?.path,
                config.storageLocation.templateDirectoryPath
              )}
            </p>
            <p>
              <strong>Destination:</strong>{' '}
              {getReadableLocationPreserveNames(
                compareState.destinationPath,
                currentWorkingLocation?.rootPath || '/mnt/media'
              )}
            </p>

            <p>
              <strong>Template .ptx:</strong>{' '}
              {compareState.ptxInfo?.hasPtx
                ? `${compareState.ptxInfo.ptxCount} found`
                : 'No .ptx found in template source'}
            </p>

            <section className="grid two-col" style={{ marginTop: 12 }}>
              <div>
                <h4 className="compare-heading">
                  Source
                  <span className={`compare-flag ${compareFreshness.source}`}>
                    {getFreshnessLabel(compareFreshness.source)}
                  </span>
                </h4>
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

            {compareState.ptxInfo && !compareState.ptxInfo.hasPtx ? (
              <div className="compare-warning-row">
                <span className="compare-flag older">No .ptx In Template Source</span>
              </div>
            ) : null}

            <div className="button-row" style={{ marginTop: 16 }}>
              {compareState.result.destination?.exists ? (
                <button
                  className="button-primary"
                  onClick={() => handleCreate('replace')}
                  disabled={creating}
                >
                  {creating ? 'Creating…' : 'Replace'}
                </button>
              ) : (
                <button
                  className="button-primary"
                  onClick={() => handleCreate('skip')}
                  disabled={creating}
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              )}

              {compareState.result.destination?.exists ? (
                <button onClick={() => handleCreate('skip')} disabled={creating}>
                  Skip
                </button>
              ) : null}
            </div>
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
  selectionHint,
  showSelected = true,
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
        </div>
        {showSelected ? <p><strong>Selected:</strong> {selectedItem?.name || 'None'}</p> : null}
        <p className={selectedItem ? 'selection-hint hidden' : 'selection-hint'}>
          <em>{selectionHint}</em>
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
          const isSelected = selectedEntry?.name === entry.name && selectedEntry?.kind === entry.kind;

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
