import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretCircleLeft, DownloadSimple, Eye, EyeClosed, Fingerprint, FloppyDiskBack, FolderOpen, GearSix, Info, PlusCircle, SecurityCamera, ShippingContainer, Trash, UploadSimple, Users, XCircle } from '@phosphor-icons/react';
import { api } from '../lib/api.js';

const SETTINGS_TAB_KEYS = {
  setup: 'setup',
  security: 'security',
  users: 'users'
};

const defaultWorkingLocation = (index = 1) => ({
  id: `working-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
  name: `Working Location ${index}`,
  host: '',
  port: 22,
  username: '',
  rootPath: '',
  isPrimary: index === 1,
  setupState: {
    containerAuthorized: false,
    storageToWorking: false,
    workingToStorage: false
  }
});

const defaultState = {
  appName: 'Session Commander',
  theme: 'system',
  storageLocation: {
    host: '',
    port: 22,
    username: '',
    rootPath: '',
    templateDirectoryPath: ''
  },
  workingLocations: [defaultWorkingLocation(1)],
  selectedWorkingLocationId: null
};

function hasConfiguredTarget(target) {
  return Boolean(target?.host?.trim() && target?.username?.trim() && target?.rootPath?.trim());
}

function normalizeConfig(config) {
  const storageLocation = {
    host: config?.storageLocation?.host || '',
    port: Number(config?.storageLocation?.port || 22),
    username: config?.storageLocation?.username || '',
    rootPath: config?.storageLocation?.rootPath || '',
    templateDirectoryPath:
      config?.storageLocation?.templateDirectoryPath ||
      config?.storageLocation?.rootPath ||
      ''
  };

  let workingLocations = Array.isArray(config?.workingLocations) && config.workingLocations.length
    ? config.workingLocations.map((drive, index) => ({
        id: drive.id || `working-${index + 1}`,
        name: drive.name || `Working Location ${index + 1}`,
        host: drive.host || '',
        port: Number(drive.port || 22),
        username: drive.username || '',
        rootPath: drive.rootPath || '',
        isPrimary: Boolean(drive.isPrimary),
        setupState: {
          containerAuthorized: Boolean(drive?.setupState?.containerAuthorized),
          storageToWorking: Boolean(drive?.setupState?.storageToWorking),
          workingToStorage: Boolean(drive?.setupState?.workingToStorage)
        }
      }))
    : [defaultWorkingLocation(1)];

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
    appName: config?.appName || defaultState.appName,
    theme: config?.theme || defaultState.theme,
    storageLocation,
    workingLocations,
    selectedWorkingLocationId
  };
}

function statusTone(state) {
  if (state === 'done') return 'success';
  if (state === 'error') return 'error';
  return 'pending';
}

export default function SetupPage({
  onSecurityChanged,
  wizardMode = false,
  onSetupProgressChanged,
  theme = 'system',
  onThemeChange,
  onWizardContinue
}) {
  const [activeTab, setActiveTab] = useState(SETTINGS_TAB_KEYS.setup);
  const [form, setForm] = useState(defaultState);
  const [bootstrap, setBootstrap] = useState({
    storagePassword: '',
    workingPassword: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [containerAction, setContainerAction] = useState({
    state: 'pending',
    loading: false,
    message: '',
    publicKey: '',
    storage: null,
    working: null
  });

  const [storageToWorkingAction, setStorageToWorkingAction] = useState({
    state: 'pending',
    loading: false,
    message: '',
    test: null
  });

  const [workingToStorageAction, setWorkingToStorageAction] = useState({
    state: 'pending',
    loading: false,
    message: '',
    test: null
  });

  const [globalMessage, setGlobalMessage] = useState('');
  const [keyStatus, setKeyStatus] = useState({
    hasContainerKey: false
  });
  const [peerTrustStatus, setPeerTrustStatus] = useState({
    checked: false,
    loading: false,
    storageToWorking: false,
    workingToStorage: false
  });
  const [connectionTest, setConnectionTest] = useState({
    storage: { loading: false, tone: 'pending', text: '' },
    working: { loading: false, tone: 'pending', text: '' }
  });
  const [configNotice, setConfigNotice] = useState({
    tone: 'pending',
    text: ''
  });
  const [authState, setAuthState] = useState({
    loading: false,
    authEnabled: false,
    hasUsers: false,
    hasAdminUser: false
  });
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userDraft, setUserDraft] = useState({
    username: '',
    role: 'user',
    password: '',
    confirmPassword: ''
  });
  const [addUserModalOpen, setAddUserModalOpen] = useState(false);
  const [addUserNotice, setAddUserNotice] = useState({ tone: 'pending', text: '' });
  const [changePasswordModal, setChangePasswordModal] = useState({
    open: false,
    username: '',
    password: '',
    confirmPassword: ''
  });
  const [changePasswordNotice, setChangePasswordNotice] = useState({ tone: 'pending', text: '' });
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const isUserPasswordLengthValid = changePasswordModal.password.length >= 8;
  const isUserPasswordMatchValid =
    Boolean(changePasswordModal.password) &&
    Boolean(changePasswordModal.confirmPassword) &&
    changePasswordModal.password === changePasswordModal.confirmPassword;
  const userPasswordLengthTone = changePasswordModal.password ? (isUserPasswordLengthValid ? 'success' : 'error') : 'pending';
  const userPasswordMatchTone =
    !changePasswordModal.password && !changePasswordModal.confirmPassword
      ? 'pending'
      : isUserPasswordMatchValid
      ? 'success'
      : !changePasswordModal.password || !changePasswordModal.confirmPassword
      ? 'pending'
      : 'error';
  const canSubmitUserPasswordChange =
    Boolean(changePasswordModal.username) &&
    isUserPasswordLengthValid &&
    isUserPasswordMatchValid &&
    !changePasswordLoading;
  const [firstUserModalOpen, setFirstUserModalOpen] = useState(false);
  const [firstUserDraft, setFirstUserDraft] = useState({
    username: '',
    password: '',
    confirmPassword: ''
  });
  const [firstUserNotice, setFirstUserNotice] = useState({ tone: 'pending', text: '' });
  const isFirstUserPasswordLengthValid = firstUserDraft.password.length >= 8;
  const isFirstUserPasswordMatchValid =
    Boolean(firstUserDraft.password) &&
    Boolean(firstUserDraft.confirmPassword) &&
    firstUserDraft.password === firstUserDraft.confirmPassword;
  const firstUserPasswordLengthTone = firstUserDraft.password ? (isFirstUserPasswordLengthValid ? 'success' : 'error') : 'pending';
  const firstUserPasswordMatchTone =
    !firstUserDraft.password && !firstUserDraft.confirmPassword
      ? 'pending'
      : isFirstUserPasswordMatchValid
      ? 'success'
      : !firstUserDraft.password || !firstUserDraft.confirmPassword
      ? 'pending'
      : 'error';
  const [clearConfigModalOpen, setClearConfigModalOpen] = useState(false);
  const [clearKeysModal, setClearKeysModal] = useState({
    open: false,
    storagePassword: '',
    workingPassword: '',
    notice: { tone: 'pending', text: '' }
  });
  const [saveConfigModal, setSaveConfigModal] = useState({
    open: false,
    name: 'config'
  });
  const [clearKnownHostsModal, setClearKnownHostsModal] = useState({
    open: false,
    host: '',
    label: '',
    side: 'storage'
  });
  const [loadConfigModal, setLoadConfigModal] = useState({
    open: false,
    mode: 'menu',
    loading: false,
    configs: []
  });
  const [knownHostsNotice, setKnownHostsNotice] = useState({
    storage: { tone: 'pending', text: '' },
    working: { tone: 'pending', text: '' }
  });
  const uploadConfigInputRef = useRef(null);

  function resetSetupProgressUiState() {
    setContainerAction({
      state: 'pending',
      loading: false,
      message: '',
      publicKey: '',
      storage: null,
      working: null
    });
    setStorageToWorkingAction({
      state: 'pending',
      loading: false,
      message: '',
      test: null
    });
    setWorkingToStorageAction({
      state: 'pending',
      loading: false,
      message: '',
      test: null
    });
    setConnectionTest({
      storage: { loading: false, tone: 'pending', text: '' },
      working: { loading: false, tone: 'pending', text: '' }
    });
  }

  const currentWorkingLocation = useMemo(
    () =>
      form.workingLocations.find((drive) => drive.id === form.selectedWorkingLocationId) ||
      form.workingLocations[0] ||
      null,
    [form.workingLocations, form.selectedWorkingLocationId]
  );

  function notifySetupProgressChanged() {
    onSetupProgressChanged?.();
  }

  useEffect(() => {
    let active = true;

    async function loadConfig() {
      try {
        const [config, authStatus, setupKeyStatus] = await Promise.all([
          api.getConfig(),
          api.getAuthStatus(),
          api.getSetupKeyStatus()
        ]);
        if (!active) return;
        setForm(normalizeConfig(config));
        setKeyStatus({
          hasContainerKey: Boolean(setupKeyStatus?.hasContainerKey)
        });
        setAuthState({
          loading: false,
          authEnabled: Boolean(authStatus.authEnabled),
          hasUsers: Boolean(authStatus.hasUsers),
          hasAdminUser: Boolean(authStatus.hasAdminUser)
        });

        setUsersLoading(true);
        const usersPayload = await api.listUsers();
        if (!active) return;
        setUsers(Array.isArray(usersPayload.users) ? usersPayload.users : []);
      } catch (error) {
        if (!active) return;
        setGlobalMessage(`Failed to load config: ${error.message}`);
      } finally {
        if (active) {
          setUsersLoading(false);
        }
        if (active) setLoading(false);
      }
    }

    loadConfig();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (wizardMode) {
      setActiveTab(SETTINGS_TAB_KEYS.setup);
    }
  }, [wizardMode]);

  async function refreshSecurityState() {
    const [authStatus, usersPayload] = await Promise.all([api.getAuthStatus(), api.listUsers()]);
    setAuthState({
      loading: false,
      authEnabled: Boolean(authStatus.authEnabled),
      hasUsers: Boolean(authStatus.hasUsers),
      hasAdminUser: Boolean(authStatus.hasAdminUser)
    });
    setUsers(Array.isArray(usersPayload.users) ? usersPayload.users : []);
  }

  useEffect(() => {
    setBootstrap({
      storagePassword: '',
      workingPassword: ''
    });

    setContainerAction({
      state: 'pending',
      loading: false,
      message: '',
      publicKey: '',
      storage: null,
      working: null
    });

    setStorageToWorkingAction({
      state: 'pending',
      loading: false,
      message: '',
      test: null
    });

    setWorkingToStorageAction({
      state: 'pending',
      loading: false,
      message: '',
      test: null
    });

    setConnectionTest({
      storage: { loading: false, tone: 'pending', text: '' },
      working: { loading: false, tone: 'pending', text: '' }
    });
  }, [form.selectedWorkingLocationId]);

  function setSelectedWorkingLocationId(id) {
    setForm((current) => ({
      ...current,
      selectedWorkingLocationId: id
    }));
  }

  function updateStorage(field, value) {
    setForm((current) => ({
      ...current,
      storageLocation: {
        ...current.storageLocation,
        [field]: field === 'port' ? Number(value || 22) : value
      }
    }));
  }

  function updateWorking(field, value) {
    if (!currentWorkingLocation) return;

    setForm((current) => ({
      ...current,
      workingLocations: current.workingLocations.map((drive) =>
        drive.id === current.selectedWorkingLocationId
          ? {
              ...drive,
              [field]: field === 'port' ? Number(value || 22) : value
            }
          : drive
      )
    }));
  }

  function updateBootstrap(field, value) {
    setBootstrap((current) => ({
      ...current,
      [field]: value
    }));
  }

  function addWorkingLocation() {
    setForm((current) => {
      const nextIndex = current.workingLocations.length + 1;
      const newDrive = defaultWorkingLocation(nextIndex);

      return {
        ...current,
        workingLocations: [...current.workingLocations, { ...newDrive, isPrimary: false }],
        selectedWorkingLocationId: newDrive.id
      };
    });
  }

  function removeCurrentWorkingLocation() {
    if (!currentWorkingLocation || form.workingLocations.length <= 1) return;

    setForm((current) => {
      const remaining = current.workingLocations.filter(
        (drive) => drive.id !== current.selectedWorkingLocationId
      );

      let nextWorkingDrives = remaining;
      if (!remaining.some((drive) => drive.isPrimary)) {
        nextWorkingDrives = remaining.map((drive, index) => ({
          ...drive,
          isPrimary: index === 0
        }));
      }

      return {
        ...current,
        workingLocations: nextWorkingDrives,
        selectedWorkingLocationId: nextWorkingDrives[0]?.id || null
      };
    });
  }

  function setCurrentWorkingLocationPrimary() {
    if (!currentWorkingLocation) return;

    setForm((current) => ({
      ...current,
      selectedWorkingLocationId: current.selectedWorkingLocationId,
      workingLocations: current.workingLocations.map((drive) => ({
        ...drive,
        isPrimary: drive.id === current.selectedWorkingLocationId
      }))
    }));
  }

  function validateStorageTarget() {
    const drive = form.storageLocation;

    if (!drive.host.trim()) throw new Error('storage location host is required');
    if (!drive.username.trim()) throw new Error('storage location username is required');
    if (!drive.rootPath.trim()) throw new Error('storage location root path is required');
    if (!drive.templateDirectoryPath.trim()) throw new Error('template directory path is required');

    return {
      host: drive.host.trim(),
      port: Number(drive.port || 22),
      username: drive.username.trim(),
      rootPath: drive.rootPath.trim(),
      templateDirectoryPath: drive.templateDirectoryPath.trim()
    };
  }

  function validateCurrentWorkingTarget() {
    if (!currentWorkingLocation) throw new Error('Add a working location first');

    if (!currentWorkingLocation.host.trim()) throw new Error('working location host is required');
    if (!currentWorkingLocation.username.trim()) throw new Error('working location username is required');
    if (!currentWorkingLocation.rootPath.trim()) throw new Error('working location root path is required');

    return {
      host: currentWorkingLocation.host.trim(),
      port: Number(currentWorkingLocation.port || 22),
      username: currentWorkingLocation.username.trim(),
      rootPath: currentWorkingLocation.rootPath.trim()
    };
  }

  function requirePasswords() {
    if (!bootstrap.storagePassword) throw new Error('storage location bootstrap password is required');
    if (!bootstrap.workingPassword) throw new Error('working location bootstrap password is required');
  }

  function openSaveConfigModal() {
    setSaveConfigModal({
      open: true,
      name: 'config'
    });
  }

  async function handleSaveConfigFromModal() {
    const configName = String(saveConfigModal.name || '').trim() || 'config';
    try {
      setSaving(true);
      setGlobalMessage('');
      setConfigNotice({ tone: 'pending', text: '' });

      const payload = normalizeConfig(form);
      const result = await api.saveConfig(payload, configName);
      setForm(normalizeConfig(result.config));
      setSaveConfigModal({ open: false, name: 'config' });
      setConfigNotice({
        tone: 'success',
        text: result.storedAs ? `Configuration saved as ${result.storedAs}.` : 'Configuration saved.'
      });
      notifySetupProgressChanged();
    } catch (error) {
      setConfigNotice({ tone: 'error', text: `Failed to save config: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function refreshConfigFromServer(successText) {
    const [config, setupKeyStatus] = await Promise.all([api.getConfig(), api.getSetupKeyStatus()]);
    setForm(normalizeConfig(config));
    setKeyStatus({
      hasContainerKey: Boolean(setupKeyStatus?.hasContainerKey)
    });
    setBootstrap({
      storagePassword: '',
      workingPassword: ''
    });
    if (successText) {
      setConfigNotice({ tone: 'success', text: successText });
    }
    notifySetupProgressChanged();
  }

  function openLoadConfigModal() {
    setLoadConfigModal({
      open: true,
      mode: 'menu',
      loading: false,
      configs: []
    });
  }

  async function showStoredConfigsInModal() {
    try {
      setLoadConfigModal((current) => ({ ...current, mode: 'stored', loading: true }));
      const payload = await api.listStoredConfigs();
      setLoadConfigModal((current) => ({
        ...current,
        mode: 'stored',
        loading: false,
        configs: Array.isArray(payload.configs) ? payload.configs : []
      }));
    } catch (error) {
      setLoadConfigModal((current) => ({ ...current, loading: false }));
      setConfigNotice({ tone: 'error', text: `Failed to list stored configs: ${error.message}` });
    }
  }

  async function handleLoadStoredConfig(fileName) {
    try {
      setLoadConfigModal((current) => ({ ...current, loading: true }));
      setConfigNotice({ tone: 'pending', text: '' });
      await api.loadStoredConfig(fileName);
      await refreshConfigFromServer(`Loaded config: ${fileName}`);
      setLoadConfigModal({ open: false, mode: 'menu', loading: false, configs: [] });
    } catch (error) {
      setLoadConfigModal((current) => ({ ...current, loading: false }));
      setConfigNotice({ tone: 'error', text: `Failed to load config: ${error.message}` });
    }
  }

  async function handleUploadConfigFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      setConfigNotice({ tone: 'pending', text: '' });
      await api.importConfig(parsed, file.name);
      await refreshConfigFromServer(`Uploaded and loaded config: ${file.name}`);
      setLoadConfigModal({ open: false, mode: 'menu', loading: false, configs: [] });
    } catch (error) {
      setConfigNotice({ tone: 'error', text: `Upload config failed: ${error.message}` });
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  }

  async function handleDownloadConfig() {
    try {
      setConfigNotice({ tone: 'pending', text: '' });
      const config = await api.getConfig();
      const fileName = 'session-commander-config.json';

      const jsonText = JSON.stringify(config, null, 2);
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: 'JSON Config',
              accept: { 'application/json': ['.json'] }
            }
          ]
        });
        const writable = await handle.createWritable();
        await writable.write(jsonText);
        await writable.close();
      } else {
        const blob = new Blob([jsonText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }
      setConfigNotice({ tone: 'success', text: `Config downloaded: ${fileName}` });
    } catch (error) {
      if (String(error?.name || '') === 'AbortError') return;
      setConfigNotice({ tone: 'error', text: `Download config failed: ${error.message}` });
    }
  }

  async function handleClearConfig() {
    try {
      setSaving(true);
      setGlobalMessage('');
      setConfigNotice({ tone: 'pending', text: '' });
      const result = await api.clearSetupConfig({});
      await refreshConfigFromServer();
      setClearConfigModalOpen(false);
      resetSetupProgressUiState();

      if (Array.isArray(result.warnings) && result.warnings.length) {
        setConfigNotice({
          tone: 'pending',
          text: `Configuration cleared with warnings: ${result.warnings.join(' | ')}`
        });
      } else {
      setConfigNotice({
          tone: 'success',
          text: 'Loaded default empty configuration.'
        });
      }
      setPeerTrustStatus({
        checked: false,
        loading: false,
        storageToWorking: false,
        workingToStorage: false
      });
      setClearKeysModal({
        open: false,
        storagePassword: '',
        workingPassword: '',
        notice: { tone: 'pending', text: '' }
      });
    } catch (error) {
      setConfigNotice({ tone: 'error', text: `Clear config failed: ${error.message}` });
    } finally {
      setSaving(false);
    }
  }

  function openClearConfigAndKeysModal() {
    setClearKeysModal({
      open: true,
      storagePassword: '',
      workingPassword: '',
      notice: { tone: 'pending', text: '' }
    });
  }

  async function handleClearConfigAndKeys() {
    try {
      if (!form.storageLocation.host?.trim() || !form.storageLocation.username?.trim()) {
        throw new Error('Storage location host and username are required');
      }
      if (!currentWorkingLocation?.host?.trim() || !currentWorkingLocation?.username?.trim()) {
        throw new Error('Working location host and username are required');
      }
      if (!clearKeysModal.storagePassword) {
        throw new Error('Storage location password is required');
      }
      if (!clearKeysModal.workingPassword) {
        throw new Error('Working location password is required');
      }

      setSaving(true);
      setClearKeysModal((current) => ({
        ...current,
        notice: { tone: 'pending', text: '' }
      }));
      setConfigNotice({ tone: 'pending', text: '' });

      const payload = {
        storageTarget: {
          host: form.storageLocation.host,
          port: Number(form.storageLocation.port) || 22,
          username: form.storageLocation.username
        },
        storagePassword: clearKeysModal.storagePassword,
        workingTarget: {
          host: currentWorkingLocation.host,
          port: Number(currentWorkingLocation.port) || 22,
          username: currentWorkingLocation.username
        },
        workingPassword: clearKeysModal.workingPassword
      };

      const result = await api.clearSetupConfigAndKeys(payload);
      await refreshConfigFromServer();
      setClearKeysModal({
        open: false,
        storagePassword: '',
        workingPassword: '',
        notice: { tone: 'pending', text: '' }
      });
      setPeerTrustStatus({
        checked: true,
        loading: false,
        storageToWorking: false,
        workingToStorage: false
      });
      setClearConfigModalOpen(false);
      resetSetupProgressUiState();

      const reportParts = [];
      if (result?.keyReport?.container) {
        const containerReport = result.keyReport.container;
        reportParts.push(
          `Container keys: before=${
            containerReport.before?.privateKey || containerReport.before?.publicKey ? 'present' : 'none'
          }, after=${
            containerReport.after?.privateKey || containerReport.after?.publicKey ? 'present' : 'none'
          }`
        );
      }
      if (result?.keyReport?.storage) {
        reportParts.push(
          `Storage peer keys: before=${result.keyReport.storage.before?.hasAny ? 'present' : 'none'}, after=${
            result.keyReport.storage.after?.hasAny ? 'present' : 'none'
          }`
        );
      }
      if (result?.keyReport?.working) {
        reportParts.push(
          `Working peer keys: before=${result.keyReport.working.before?.hasAny ? 'present' : 'none'}, after=${
            result.keyReport.working.after?.hasAny ? 'present' : 'none'
          }`
        );
      }
      const reportText = reportParts.length ? ` Report: ${reportParts.join(' | ')}` : '';

      if (Array.isArray(result.warnings) && result.warnings.length) {
        setConfigNotice({
          tone: 'pending',
          text: `Configuration loaded and key cleanup completed with warnings: ${result.warnings.join(' | ')}.${reportText}`
        });
      } else if (!result.keysFound) {
        setConfigNotice({
          tone: 'success',
          text: `Loaded default empty configuration. No SSH keys were found to remove.${reportText}`
        });
      } else {
        setConfigNotice({
          tone: 'success',
          text: `Loaded default empty configuration and removed SSH keys from configured systems.${reportText}`
        });
      }
    } catch (error) {
      setClearKeysModal((current) => ({
        ...current,
        notice: { tone: 'error', text: error.message }
      }));
    } finally {
      setSaving(false);
    }
  }

  async function handleClearContainerKnownHostsForHost(host, label, side = 'storage') {
    try {
      const normalizedHost = String(host || '').trim();
      if (!normalizedHost) {
        throw new Error(`${label} host is required`);
      }

      setSaving(true);
      setConfigNotice({ tone: 'pending', text: '' });
      const result = await api.clearSetupContainerKnownHosts({
        hosts: [normalizedHost]
      });

      if (Array.isArray(result.warnings) && result.warnings.length) {
        setKnownHostsNotice((current) => ({
          ...current,
          [side]: {
            tone: 'pending',
            text: `${label} known_hosts cleared with warnings: ${result.warnings.join(' | ')}`
          }
        }));
      } else {
        setKnownHostsNotice((current) => ({
          ...current,
          [side]: {
            tone: 'success',
            text: `${label} known_hosts entry cleared for ${normalizedHost}.`
          }
        }));
      }
    } catch (error) {
      setKnownHostsNotice((current) => ({
        ...current,
        [side]: {
          tone: 'error',
          text: `Clear known_hosts failed: ${error.message}`
        }
      }));
    } finally {
      setSaving(false);
    }
  }

  function openClearKnownHostsConfirm(host, label, side) {
    setClearKnownHostsModal({
      open: true,
      host: String(host || '').trim(),
      label,
      side
    });
  }

  async function persistCurrentWorkingLocationSetupState(patch) {
    if (!currentWorkingLocation) return;

    const nextForm = {
      ...form,
      workingLocations: form.workingLocations.map((drive) =>
        drive.id === currentWorkingLocation.id
          ? {
              ...drive,
              setupState: {
                ...drive.setupState,
                ...patch
              }
            }
          : drive
      )
    };

    setForm(nextForm);

    try {
      const result = await api.saveConfig(normalizeConfig(nextForm));
      setForm(normalizeConfig(result.config));
      notifySetupProgressChanged();
    } catch (error) {
      setGlobalMessage(`Action completed, but failed to save setup status: ${error.message}`);
    }
  }

  async function handleAuthorizeContainer() {
    try {
      requirePasswords();
      const storageTarget = validateStorageTarget();
      const workingTarget = validateCurrentWorkingTarget();

      setContainerAction((current) => ({
        ...current,
        loading: true,
        state: 'pending',
        message: ''
      }));
      setGlobalMessage('');

      const result = await api.authorizeContainer({
        storageTarget: {
          host: storageTarget.host,
          port: storageTarget.port,
          username: storageTarget.username
        },
        storagePassword: bootstrap.storagePassword,
        workingTarget: {
          host: workingTarget.host,
          port: workingTarget.port,
          username: workingTarget.username
        },
        workingPassword: bootstrap.workingPassword
      });

      setContainerAction({
        state: 'done',
        loading: false,
        message: `Container access is ready for storage location and ${currentWorkingLocation.name}.`,
        publicKey: result.publicKey || '',
        storage: result.storage || null,
        working: result.working || null
      });
      setKeyStatus({
        hasContainerKey: true
      });
      setPeerTrustStatus({
        checked: true,
        loading: false,
        storageToWorking: false,
        workingToStorage: false
      });

      await persistCurrentWorkingLocationSetupState({
        containerAuthorized: true,
        storageToWorking: false,
        workingToStorage: false
      });
    } catch (error) {
      const raw = String(error.message || '');
      const hint = raw.includes('Permission denied (publickey,keyboard-interactive)')
        ? ' Verify bootstrap password and ensure password or keyboard-interactive login is enabled on the target.'
        : '';
      setContainerAction((current) => ({
        ...current,
        loading: false,
        state: 'error',
        message: `${error.message}${hint}`
      }));
    }
  }

  async function handleEnableStorageToWorking() {
    try {
      requirePasswords();
      const storageTarget = validateStorageTarget();
      const workingTarget = validateCurrentWorkingTarget();

      setStorageToWorkingAction((current) => ({
        ...current,
        loading: true,
        state: 'pending',
        message: ''
      }));

      const result = await api.enableStorageToWorking({
        storageTarget: {
          host: storageTarget.host,
          port: storageTarget.port,
          username: storageTarget.username
        },
        storagePassword: bootstrap.storagePassword,
        workingTarget: {
          host: workingTarget.host,
          port: workingTarget.port,
          username: workingTarget.username
        },
        workingPassword: bootstrap.workingPassword
      });

      setStorageToWorkingAction({
        state: 'done',
        loading: false,
        message: `Storage location can now connect directly to ${currentWorkingLocation.name}.`,
        test: result.test || null
      });
      setPeerTrustStatus((current) => ({
        ...current,
        checked: true,
        storageToWorking: true
      }));

      await persistCurrentWorkingLocationSetupState({
        storageToWorking: true
      });
    } catch (error) {
      setStorageToWorkingAction((current) => ({
        ...current,
        loading: false,
        state: 'error',
        message: error.message
      }));
    }
  }

  async function handleEnableWorkingToStorage() {
    try {
      requirePasswords();
      const storageTarget = validateStorageTarget();
      const workingTarget = validateCurrentWorkingTarget();

      setWorkingToStorageAction((current) => ({
        ...current,
        loading: true,
        state: 'pending',
        message: ''
      }));

      const result = await api.enableWorkingToStorage({
        storageTarget: {
          host: storageTarget.host,
          port: storageTarget.port,
          username: storageTarget.username
        },
        storagePassword: bootstrap.storagePassword,
        workingTarget: {
          host: workingTarget.host,
          port: workingTarget.port,
          username: workingTarget.username
        },
        workingPassword: bootstrap.workingPassword
      });

      setWorkingToStorageAction({
        state: 'done',
        loading: false,
        message: `${currentWorkingLocation.name} can now connect directly to storage location.`,
        test: result.test || null
      });
      setPeerTrustStatus((current) => ({
        ...current,
        checked: true,
        workingToStorage: true
      }));

      await persistCurrentWorkingLocationSetupState({
        workingToStorage: true
      });
    } catch (error) {
      setWorkingToStorageAction((current) => ({
        ...current,
        loading: false,
        state: 'error',
        message: error.message
      }));
    }
  }

  function updateUserDraft(field, value) {
    setUserDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateFirstUserDraft(field, value) {
    setFirstUserNotice({ tone: 'pending', text: '' });
    setFirstUserDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleTestBootstrapConnection(side) {
    try {
      const target = side === 'storage' ? validateStorageTarget() : validateCurrentWorkingTarget();
      const password = side === 'storage' ? bootstrap.storagePassword : bootstrap.workingPassword;
      if (!password) {
        throw new Error(`${side === 'storage' ? 'Storage location' : 'Working location'} bootstrap password is required`);
      }

      setConnectionTest((current) => ({
        ...current,
        [side]: { loading: true, tone: 'pending', text: '' }
      }));

      await api.testBootstrapConnection({
        target: {
          host: target.host,
          port: target.port,
          username: target.username
        },
        password
      });

      setConnectionTest((current) => ({
        ...current,
        [side]: {
          loading: false,
          tone: 'success',
          text: `${side === 'storage' ? 'Storage location' : 'Working location'} bootstrap connection succeeded.`
        }
      }));
    } catch (error) {
      setConnectionTest((current) => ({
        ...current,
        [side]: {
          loading: false,
          tone: 'error',
          text: error.message
        }
      }));
    }
  }

  async function handleToggleAuth() {
    try {
      setAuthState((current) => ({ ...current, loading: true }));
      setGlobalMessage('');

      const nextEnabled = !authState.authEnabled;
      if (nextEnabled && !users.some((user) => user.role === 'admin')) {
        setFirstUserNotice({ tone: 'pending', text: '' });
        setFirstUserModalOpen(true);
        setAuthState((current) => ({ ...current, loading: false }));
        return;
      }
      await api.setAuthEnabled(nextEnabled);
      await refreshSecurityState();
      if (onSecurityChanged) await onSecurityChanged();
      setGlobalMessage(
        nextEnabled
          ? 'Authentication is now enabled.'
          : 'Authentication has been disabled.'
      );
    } catch (error) {
      setGlobalMessage(`Security update failed: ${error.message}`);
    } finally {
      setAuthState((current) => ({ ...current, loading: false }));
    }
  }

  async function handleCreateFirstUserAndEnableAuth() {
    try {
      if (firstUserDraft.password !== firstUserDraft.confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (firstUserDraft.password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      setUsersLoading(true);
      setGlobalMessage('');
      setFirstUserNotice({ tone: 'pending', text: '' });
      await api.createUser({
        username: firstUserDraft.username.trim(),
        password: firstUserDraft.password,
        role: 'admin'
      });
      await api.setAuthEnabled(true);
      await refreshSecurityState();
      if (onSecurityChanged) await onSecurityChanged();
      setFirstUserModalOpen(false);
      setFirstUserDraft({
        username: '',
        password: '',
        confirmPassword: ''
      });
      setGlobalMessage('Authentication enabled with a new admin user.');
    } catch (error) {
      setFirstUserNotice({ tone: 'error', text: error.message });
      setGlobalMessage(`Enable auth failed: ${error.message}`);
    } finally {
      setUsersLoading(false);
      setAuthState((current) => ({ ...current, loading: false }));
    }
  }

  async function handleAddUser() {
    try {
      if (userDraft.password !== userDraft.confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (userDraft.password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      setUsersLoading(true);
      setGlobalMessage('');
      setAddUserNotice({ tone: 'pending', text: '' });
      const payload = await api.createUser({
        username: userDraft.username.trim(),
        password: userDraft.password,
        role: userDraft.role
      });
      setUsers(Array.isArray(payload.users) ? payload.users : []);
      setUserDraft({
        username: '',
        role: 'user',
        password: '',
        confirmPassword: ''
      });
      await refreshSecurityState();
      setAddUserModalOpen(false);
      setGlobalMessage('User added.');
    } catch (error) {
      setAddUserNotice({ tone: 'error', text: error.message });
      setGlobalMessage(`Add user failed: ${error.message}`);
    } finally {
      setUsersLoading(false);
    }
  }

  async function handleDeleteUser(username) {
    try {
      setUsersLoading(true);
      setGlobalMessage('');
      const payload = await api.deleteUser(username);
      setUsers(Array.isArray(payload.users) ? payload.users : []);
      await refreshSecurityState();
      setGlobalMessage(`Removed user "${username}".`);
    } catch (error) {
      setGlobalMessage(`Remove user failed: ${error.message}`);
    } finally {
      setUsersLoading(false);
    }
  }

  function openChangePasswordModal(username) {
    setChangePasswordModal({
      open: true,
      username,
      password: '',
      confirmPassword: ''
    });
    setChangePasswordNotice({ tone: 'pending', text: '' });
  }

  function closeChangePasswordModal() {
    setChangePasswordModal({
      open: false,
      username: '',
      password: '',
      confirmPassword: ''
    });
    setChangePasswordNotice({ tone: 'pending', text: '' });
  }

  async function handleChangeUserPassword() {
    try {
      if (!changePasswordModal.username) {
        throw new Error('Username is required');
      }
      if (changePasswordModal.password !== changePasswordModal.confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (changePasswordModal.password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      setChangePasswordLoading(true);
      setChangePasswordNotice({ tone: 'pending', text: '' });
      setGlobalMessage('');
      const payload = await api.changeUserPassword(changePasswordModal.username, changePasswordModal.password);
      setUsers(Array.isArray(payload.users) ? payload.users : []);
      await refreshSecurityState();
      closeChangePasswordModal();
      setGlobalMessage(`Password updated for "${changePasswordModal.username}".`);
    } catch (error) {
      setChangePasswordNotice({ tone: 'error', text: error.message });
      setGlobalMessage(`Change password failed: ${error.message}`);
    } finally {
      setChangePasswordLoading(false);
    }
  }

  const selectedSetupState = currentWorkingLocation?.setupState || {
    containerAuthorized: false,
    storageToWorking: false,
    workingToStorage: false
  };
  const effectiveSetupState = keyStatus.hasContainerKey
    ? selectedSetupState
    : {
        containerAuthorized: false,
        storageToWorking: false,
        workingToStorage: false
      };

  function getPeerTargetsForCheck() {
    if (!keyStatus.hasContainerKey) return null;
    const storageHost = String(form.storageLocation.host || '').trim();
    const storageUser = String(form.storageLocation.username || '').trim();
    const workingHost = String(currentWorkingLocation?.host || '').trim();
    const workingUser = String(currentWorkingLocation?.username || '').trim();

    if (!storageHost || !storageUser || !workingHost || !workingUser) return null;

    return {
      storageTarget: {
        host: storageHost,
        port: Number(form.storageLocation.port) || 22,
        username: storageUser
      },
      workingTarget: {
        host: workingHost,
        port: Number(currentWorkingLocation?.port) || 22,
        username: workingUser
      }
    };
  }

  async function refreshPeerTrustStatus({ persist = false } = {}) {
    const targets = getPeerTargetsForCheck();
    if (!targets) {
      setPeerTrustStatus({
        checked: true,
        loading: false,
        storageToWorking: false,
        workingToStorage: false
      });
      return {
        storageToWorking: false,
        workingToStorage: false
      };
    }

    setPeerTrustStatus((current) => ({ ...current, loading: true }));

    const [storageToWorkingProbe, workingToStorageProbe] = await Promise.allSettled([
      api.testPeerConnection({
        sourceTarget: targets.storageTarget,
        destinationTarget: targets.workingTarget
      }),
      api.testPeerConnection({
        sourceTarget: targets.workingTarget,
        destinationTarget: targets.storageTarget
      })
    ]);

    const next = {
      storageToWorking: storageToWorkingProbe.status === 'fulfilled',
      workingToStorage: workingToStorageProbe.status === 'fulfilled'
    };

    setPeerTrustStatus({
      checked: true,
      loading: false,
      ...next
    });

    if (
      persist &&
      currentWorkingLocation &&
      (selectedSetupState.storageToWorking !== next.storageToWorking ||
        selectedSetupState.workingToStorage !== next.workingToStorage)
    ) {
      await persistCurrentWorkingLocationSetupState({
        storageToWorking: next.storageToWorking,
        workingToStorage: next.workingToStorage
      });
    }

    return next;
  }

  useEffect(() => {
    let active = true;

    async function probeTrust() {
      try {
        const targets = getPeerTargetsForCheck();
        if (!targets) {
          if (!active) return;
          setPeerTrustStatus({
            checked: true,
            loading: false,
            storageToWorking: false,
            workingToStorage: false
          });
          return;
        }
        await refreshPeerTrustStatus({ persist: true });
      } catch {
        if (!active) return;
        setPeerTrustStatus((current) => ({ ...current, loading: false, checked: true }));
      }
    }

    probeTrust();
    return () => {
      active = false;
    };
  }, [
    keyStatus.hasContainerKey,
    currentWorkingLocation?.id,
    currentWorkingLocation?.host,
    currentWorkingLocation?.port,
    currentWorkingLocation?.username,
    form.storageLocation.host,
    form.storageLocation.port,
    form.storageLocation.username
  ]);

  const resolvedStorageToWorkingTrust = peerTrustStatus.checked
    ? peerTrustStatus.storageToWorking
    : effectiveSetupState.storageToWorking;
  const resolvedWorkingToStorageTrust = peerTrustStatus.checked
    ? peerTrustStatus.workingToStorage
    : effectiveSetupState.workingToStorage;

  const containerDisplayState =
    containerAction.state === 'error'
      ? 'error'
      : containerAction.state === 'done' || effectiveSetupState.containerAuthorized
        ? 'done'
        : 'pending';

  const storageToWorkingDisplayState =
    storageToWorkingAction.state === 'error'
      ? 'error'
      : storageToWorkingAction.state === 'done' || resolvedStorageToWorkingTrust
        ? 'done'
        : 'pending';

  const workingToStorageDisplayState =
    workingToStorageAction.state === 'error'
      ? 'error'
      : workingToStorageAction.state === 'done' || resolvedWorkingToStorageTrust
        ? 'done'
        : 'pending';

  const targetsConfigured =
    hasConfiguredTarget(form.storageLocation) &&
    Boolean(form.storageLocation.templateDirectoryPath?.trim()) &&
    hasConfiguredTarget(currentWorkingLocation);

  const trustStepReady =
    storageToWorkingDisplayState === 'done' && workingToStorageDisplayState === 'done';

  const summary = useMemo(() => {
    const readyCount = [
      targetsConfigured,
      containerDisplayState === 'done',
      trustStepReady
    ].filter(Boolean).length;

    return `${readyCount}/3 setup steps completed`;
  }, [targetsConfigured, containerDisplayState, trustStepReady]);

  const allSetupStepsComplete = targetsConfigured && containerDisplayState === 'done' && trustStepReady;

  if (loading) {
    return (
      <section className="panel">
        <h2>{wizardMode ? 'Setup Wizard' : 'Configuration'}</h2>
        <p>Loading configuration…</p>
      </section>
    );
  }

  return (
    <section className="content">
      {wizardMode ? (
        <header className="topbar setup-wizard-brand">
          <div className="topbar-brand">
            <ShippingContainer className="topbar-logo" size={28} weight="duotone" aria-hidden="true" />
            <h1>Session Commander</h1>
          </div>
          <div className="topbar-actions">
            <div className="theme-control">
              <select
                value={theme || 'system'}
                onChange={(e) => onThemeChange?.(e.target.value)}
                aria-label="Theme"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </header>
      ) : null}

      {!wizardMode ? <div className="settings-section-divider" /> : null}

      {!wizardMode ? (
        <section className="nav-row settings-tabs">
          <button
            className={activeTab === SETTINGS_TAB_KEYS.setup ? 'nav-button active' : 'nav-button'}
            onClick={() => setActiveTab(SETTINGS_TAB_KEYS.setup)}
          >
            <GearSix size={18} weight="duotone" aria-hidden="true" />
            Configuration
          </button>
          <button
            className={activeTab === SETTINGS_TAB_KEYS.security ? 'nav-button active' : 'nav-button'}
            onClick={() => setActiveTab(SETTINGS_TAB_KEYS.security)}
          >
            <SecurityCamera size={18} weight="duotone" aria-hidden="true" />
            Security
          </button>
          <button
            className={activeTab === SETTINGS_TAB_KEYS.users ? 'nav-button active' : 'nav-button'}
            onClick={() => setActiveTab(SETTINGS_TAB_KEYS.users)}
          >
            <Users size={18} weight="duotone" aria-hidden="true" />
            Users
          </button>
        </section>
      ) : null}
      {globalMessage ? <p>{globalMessage}</p> : null}
      <input
        ref={uploadConfigInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleUploadConfigFile}
      />

      {activeTab === SETTINGS_TAB_KEYS.setup ? (
        <>
      <section className="panel step-panel">
        <div className="panel-header">
          <h2 className="section-title-with-icon">
            {!wizardMode ? <GearSix size={22} weight="duotone" aria-hidden="true" /> : null}
            {wizardMode ? 'Setup Wizard' : 'Configuration'}
          </h2>
          <StatusPill
            tone={allSetupStepsComplete ? 'success' : 'pending'}
            label={summary}
          />
        </div>
        <p className="setup-intro-lead setup-intro-lead-full">
          Configure your locations below. You can configure multiple working locations.
        </p>
        <div className="setup-intro">
          <div className="setup-intro-item">
            <span className="setup-label-tag">Storage Location</span>
            <p>Source of session backups and templates.</p>
          </div>
          <div className="setup-intro-item">
            <span className="setup-label-tag">Working Location</span>
            <p className="setup-working-line">
              Location where sessions are run from. This can be a network share or a folder on your local machine.
            </p>
          </div>
        </div>
        <div className="result-banner pending setup-mac-note">
          For Mac&apos;s, make sure SSH is enabled in System Settings -> General -> Sharing ->
          Remote Login, as well as Wake for Network Access in General -> Energy.
          To get the path of a folder, right click the folder while holding option, then select
          "copy foldername as pathname".
        </div>
      </section>

      <section className="panel step-panel">
        <div className="panel-header">
          <div>
            <h3>1. Configure Targets</h3>
            <p>Set the storage location once, then add and manage working locations.</p>
          </div>
          <div className="button-row">
            <button
              className="setup-icon-button setup-icon-button-neutral"
              onClick={openLoadConfigModal}
              disabled={saving}
              title="Load Config"
              aria-label="Load Config"
            >
              <UploadSimple size={18} weight="duotone" aria-hidden="true" />
            </button>
            <button
              className="setup-icon-button setup-icon-button-neutral"
              onClick={handleDownloadConfig}
              disabled={saving}
              title="Download Config"
              aria-label="Download Config"
            >
              <DownloadSimple size={18} weight="duotone" aria-hidden="true" />
            </button>
            <button
              className="setup-icon-button setup-icon-button-danger"
              onClick={() => setClearConfigModalOpen(true)}
              disabled={saving}
              title="Clear Config"
              aria-label="Clear Config"
            >
              <IconTrash />
            </button>
            <button
              className="setup-icon-button"
              onClick={openSaveConfigModal}
              disabled={saving}
              title="Save Config"
              aria-label="Save Config"
            >
              <IconSave />
            </button>
          </div>
        </div>
        {configNotice.text ? (
          <div className="notice-slot" style={{ marginBottom: 12 }}>
            <ResultBanner tone={configNotice.tone} text={configNotice.text} />
          </div>
        ) : null}

        <section className="setup-config-grid">
        <section className="subpanel setup-config-card">
          <h4>Storage Location</h4>

          <section className="setup-field-stack">
            <label>
              Host
              <input
                type="text"
                value={form.storageLocation.host}
                onChange={(e) => updateStorage('host', e.target.value)}
              />
            </label>

            <label>
              SSH Port
              <input
                type="number"
                value={form.storageLocation.port}
                onChange={(e) => updateStorage('port', e.target.value)}
              />
            </label>

            <label>
              Username
              <input
                type="text"
                value={form.storageLocation.username}
                onChange={(e) => updateStorage('username', e.target.value)}
              />
            </label>

            <label>
              <LabelWithInfo
                label="Root Path"
                info="Root path of the storage location/share where you store your sessions"
              />
              <input
                type="text"
                value={form.storageLocation.rootPath}
                onChange={(e) => updateStorage('rootPath', e.target.value)}
              />
            </label>

            <label>
              <LabelWithInfo
                label="Template Directory Path"
                info="Path to the folder where you store your templates"
              />
              <input
                type="text"
                value={form.storageLocation.templateDirectoryPath}
                onChange={(e) => updateStorage('templateDirectoryPath', e.target.value)}
              />
            </label>
          </section>
          {knownHostsNotice.storage.text ? (
            <div className="notice-slot" style={{ marginTop: 10, marginBottom: 10 }}>
              <ResultBanner tone={knownHostsNotice.storage.tone} text={knownHostsNotice.storage.text} />
            </div>
          ) : null}
          <div className="button-row setup-known-hosts-actions">
            <InfoIconWithPopover info="Removes saved SSH host fingerprints for this host in the container. Use if host keys changed or you see host verification/auth errors." />
            <button
              onClick={() => openClearKnownHostsConfirm(form.storageLocation.host, 'Storage location', 'storage')}
              disabled={saving}
            >
              Clear Known Hosts
            </button>
          </div>
        </section>

        <section className="subpanel setup-config-card">
          <div className="panel-header">
            <div>
              <h4>Working Locations</h4>
              <p>Choose one working location to edit and set up.</p>
            </div>
            <div className="button-row">
              <button
                className="setup-icon-button setup-icon-button-danger"
                onClick={removeCurrentWorkingLocation}
                disabled={form.workingLocations.length <= 1}
                title="Remove Working Location"
                aria-label="Remove Working Location"
              >
                <IconTrash />
              </button>
              <button
                className="setup-icon-button button-primary setup-icon-plus"
                onClick={addWorkingLocation}
                title="Add Working Location"
                aria-label="Add Working Location"
              >
                <PlusCircle size={20} weight="duotone" aria-hidden="true" />
              </button>
            </div>
          </div>

          <section className="setup-working-select-row" style={{ marginTop: 12 }}>
            <label className="working-location-picker">
              Select Working Location
              <select
                className="setup-working-select-half"
                value={form.selectedWorkingLocationId || ''}
                onChange={(e) => setSelectedWorkingLocationId(e.target.value)}
              >
                {form.workingLocations.map((drive) => (
                  <option key={drive.id} value={drive.id}>
                    {drive.name}{drive.isPrimary ? ' (Primary)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="button-row" style={{ justifyContent: 'flex-start' }}>
              <button
                className={`setup-primary-button ${currentWorkingLocation?.isPrimary ? 'button-primary' : ''}`.trim()}
                onClick={setCurrentWorkingLocationPrimary}
                disabled={!currentWorkingLocation || currentWorkingLocation.isPrimary}
              >
                Primary
              </button>
            </div>
          </section>

          {currentWorkingLocation ? (
            <section className="setup-field-stack" style={{ marginTop: 16 }}>
              <label>
                Display Name
                <input
                  type="text"
                  value={currentWorkingLocation.name}
                  onChange={(e) => updateWorking('name', e.target.value)}
                />
              </label>

              <label>
                Host
                <input
                  type="text"
                  value={currentWorkingLocation.host}
                  onChange={(e) => updateWorking('host', e.target.value)}
                />
              </label>

              <label>
                SSH Port
                <input
                  type="number"
                  value={currentWorkingLocation.port}
                  onChange={(e) => updateWorking('port', e.target.value)}
                />
              </label>

              <label>
                Username
                <input
                  type="text"
                  value={currentWorkingLocation.username}
                  onChange={(e) => updateWorking('username', e.target.value)}
                />
              </label>

              <label>
                <LabelWithInfo
                  label="Root Path"
                  info="Root path of the working share/folder"
                />
                <input
                  type="text"
                  value={currentWorkingLocation.rootPath}
                  onChange={(e) => updateWorking('rootPath', e.target.value)}
                />
              </label>
            </section>
          ) : null}
          {currentWorkingLocation ? (
            <>
            {knownHostsNotice.working.text ? (
              <div className="notice-slot" style={{ marginTop: 10, marginBottom: 10 }}>
                <ResultBanner tone={knownHostsNotice.working.tone} text={knownHostsNotice.working.text} />
              </div>
            ) : null}
            <div className="button-row setup-known-hosts-actions">
              <InfoIconWithPopover info="Removes saved SSH host fingerprints for this host in the container. Use if host keys changed or you see host verification/auth errors." />
              <button
                onClick={() =>
                  openClearKnownHostsConfirm(
                    currentWorkingLocation.host,
                    currentWorkingLocation.name || 'Working location',
                    'working'
                  )
                }
                disabled={saving}
              >
                Clear Known Hosts
              </button>
            </div>
            </>
          ) : null}
        </section>
        </section>
      </section>

      <section className="panel step-panel">
        <div className="panel-header">
          <div className="authorize-header-content">
            <h3>2. Authorize Container Access</h3>
            <p>Authorize the container against the storage location and the selected working location.</p>
            <div className="setup-info-label">
              These passwords are not saved anywhere, they are only used for the authorization process
              and automatically clear when setup is done.
            </div>
          </div>
          <div className="action-stack">
            <StatusPill
              tone={statusTone(containerDisplayState)}
              label={containerDisplayState === 'done' ? 'Ready' : containerDisplayState === 'error' ? 'Issue' : 'Pending'}
            />
            <button
              className="button-primary authorize-button"
              onClick={handleAuthorizeContainer}
              disabled={containerAction.loading || !currentWorkingLocation}
            >
              {containerAction.loading ? 'Working…' : 'Authorize'}
            </button>
          </div>
        </div>

        <section className="grid two-col authorize-password-grid">
          <label>
            Storage Location {form.storageLocation.username ? `${form.storageLocation.username} ` : ''}Password
            <div className="authorize-password-row">
              <div className="authorize-password-field">
                <PasswordField
                  value={bootstrap.storagePassword}
                  onChange={(e) => updateBootstrap('storagePassword', e.target.value)}
                />
              </div>
              <button
                className="authorize-test-button"
                onClick={() => handleTestBootstrapConnection('storage')}
                disabled={connectionTest.storage.loading}
              >
                {connectionTest.storage.loading ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
          </label>

          <label>
            {(currentWorkingLocation?.name || 'Working Location')} {currentWorkingLocation?.username ? `${currentWorkingLocation.username} ` : ''}Password
            <div className="authorize-password-row">
              <div className="authorize-password-field">
                <PasswordField
                  value={bootstrap.workingPassword}
                  onChange={(e) => updateBootstrap('workingPassword', e.target.value)}
                />
              </div>
              <button
                className="authorize-test-button"
                onClick={() => handleTestBootstrapConnection('working')}
                disabled={connectionTest.working.loading}
              >
                {connectionTest.working.loading ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
          </label>
        </section>

        {connectionTest.storage.text ? (
          <ResultBanner tone={connectionTest.storage.tone} text={connectionTest.storage.text} />
        ) : null}
        {connectionTest.working.text ? (
          <ResultBanner tone={connectionTest.working.tone} text={connectionTest.working.text} />
        ) : null}

        {containerAction.message ? (
          <ResultBanner tone={statusTone(containerAction.state)} text={containerAction.message} />
        ) : selectedSetupState.containerAuthorized && keyStatus.hasContainerKey ? (
          <ResultBanner tone="success" text="Container access was previously configured for this working location." />
        ) : selectedSetupState.containerAuthorized && !keyStatus.hasContainerKey ? (
          <ResultBanner
            tone="pending"
            text="Saved config indicates container access was previously configured, but local container SSH keys are missing. Re-authorize container."
          />
        ) : null}
      </section>

      <section className="panel step-panel">
        <div className="panel-header">
          <div>
            <h3>3. Enable Direct Location-to-Location Trust</h3>
            <p>The selected working location only needs trust with the storage location, not with other working locations.</p>
          </div>
        </div>

        <section className="grid two-col">
          <section className="subpanel">
            <div className="panel-header trust-panel-header">
              <div>
                <h4>Storage Location → {currentWorkingLocation?.name || 'Working Location'}</h4>
                <p>Allows restoring from storage to working location.</p>
              </div>
              <StatusPill
                tone={statusTone(storageToWorkingDisplayState)}
                label={storageToWorkingDisplayState === 'done' ? 'Ready' : storageToWorkingDisplayState === 'error' ? 'Issue' : 'Pending'}
              />
            </div>

            {storageToWorkingAction.message ? (
              <ResultBanner tone={statusTone(storageToWorkingAction.state)} text={storageToWorkingAction.message} />
            ) : resolvedStorageToWorkingTrust ? (
              <ResultBanner tone="success" text="Storage location trust was previously configured for this working location." />
            ) : null}

            <div className="trust-enable-row">
              <button
                className="button-primary"
                onClick={handleEnableStorageToWorking}
                disabled={storageToWorkingAction.loading || !currentWorkingLocation}
              >
                {storageToWorkingAction.loading ? 'Working…' : 'Enable'}
              </button>
            </div>
          </section>

          <section className="subpanel">
            <div className="panel-header trust-panel-header">
              <div>
                <h4>{currentWorkingLocation?.name || 'Working Location'} → Storage Location</h4>
                <p>Allows backup from working location to storage.</p>
              </div>
              <StatusPill
                tone={statusTone(workingToStorageDisplayState)}
                label={workingToStorageDisplayState === 'done' ? 'Ready' : workingToStorageDisplayState === 'error' ? 'Issue' : 'Pending'}
              />
            </div>

            {workingToStorageAction.message ? (
              <ResultBanner tone={statusTone(workingToStorageAction.state)} text={workingToStorageAction.message} />
            ) : resolvedWorkingToStorageTrust ? (
              <ResultBanner tone="success" text="Working location trust was previously configured for this working location." />
            ) : null}

            <div className="trust-enable-row">
              <button
                className="button-primary"
                onClick={handleEnableWorkingToStorage}
                disabled={workingToStorageAction.loading || !currentWorkingLocation}
              >
                {workingToStorageAction.loading ? 'Working…' : 'Enable'}
              </button>
            </div>
          </section>
        </section>
      </section>

      {wizardMode ? (
        <section className="panel step-panel">
          <div className="panel-header">
            <div>
              <h3>4. Optional Security</h3>
              <p>Authentication is optional. You can enable it now or continue with open access.</p>
            </div>
            <StatusPill
              tone={authState.authEnabled ? 'success' : 'pending'}
              label={authState.authEnabled ? 'Auth Enabled' : 'Auth Disabled'}
            />
          </div>
          <section className="subpanel">
            <p>
              <strong>Current Mode:</strong>{' '}
              {authState.authEnabled ? 'Protected (login required)' : 'Open (no login required)'}
            </p>
            <p>
              <strong>Admin User Configured:</strong> {authState.hasAdminUser ? 'Yes' : 'No'}
            </p>
            <div className="button-row" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
              <button className="button-primary" onClick={handleToggleAuth} disabled={authState.loading}>
                {authState.loading
                  ? 'Saving…'
                  : authState.authEnabled
                    ? 'Disable Authentication'
                    : 'Enable Authentication'}
              </button>
              <button
                onClick={() => onWizardContinue?.()}
                disabled={!allSetupStepsComplete}
              >
                {authState.authEnabled ? 'Continue' : 'Continue Without Auth'}
              </button>
            </div>
            {!allSetupStepsComplete ? (
              <div className="result-banner pending" style={{ marginTop: 10 }}>
                Complete all 3 setup steps before continuing.
              </div>
            ) : null}
          </section>
        </section>
      ) : null}
        </>
      ) : null}

      {activeTab === SETTINGS_TAB_KEYS.security ? (
        !wizardMode ? (
        <section className="panel step-panel">
          <div className="panel-header security-panel-header">
            <div>
              <h2 className="section-title-with-icon">
                <SecurityCamera size={22} weight="duotone" aria-hidden="true" />
                Security
              </h2>
              <p>Keep authentication disabled for open access, or enable it to require sign in.</p>
            </div>
            <StatusPill
              className="security-header-pill"
              tone={authState.authEnabled ? 'success' : 'pending'}
              label={authState.authEnabled ? 'Auth Enabled' : 'Auth Disabled'}
            />
          </div>

          <section className="subpanel security-subpanel">
            <p>
              <strong>Current Mode:</strong>{' '}
              {authState.authEnabled ? 'Protected (login required)' : 'Open (no login required)'}
            </p>
            <p>
              <strong>Users Configured:</strong> {authState.hasUsers ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>Admin User Configured:</strong> {authState.hasAdminUser ? 'Yes' : 'No'}
            </p>
            {!authState.hasAdminUser ? (
              <div className="result-banner pending security-floating-banner">
                Add at least one admin user before enabling authentication
              </div>
            ) : null}
            <div className="security-auth-actions">
              <button
                className="button-primary"
                onClick={handleToggleAuth}
                disabled={authState.loading}
              >
                {authState.loading
                  ? 'Saving…'
                  : authState.authEnabled
                    ? 'Disable Authentication'
                    : 'Enable Authentication'}
              </button>
            </div>
          </section>
        </section>
        ) : null
      ) : null}

      {activeTab === SETTINGS_TAB_KEYS.users ? (
        !wizardMode ? (
        <section className="panel step-panel">
          <div className="panel-header users-panel-header">
            <div>
              <h2 className="section-title-with-icon">
                <Users size={22} weight="duotone" aria-hidden="true" />
                Users
              </h2>
              <p>Manage users that can sign in when authentication is enabled.</p>
            </div>
            <button
              className="button-primary users-header-add"
              onClick={() => {
                setAddUserNotice({ tone: 'pending', text: '' });
                setAddUserModalOpen(true);
              }}
            >
              Add User
            </button>
          </div>

          <section className="subpanel">
            <h4>Configured Users</h4>
            {usersLoading ? <p>Loading users…</p> : null}
            {!usersLoading && users.length === 0 ? <p>No users configured.</p> : null}
            {!usersLoading && users.length ? (
              <ul className="entry-list">
                {users.map((user) => (
                  <li key={user.username}>
                    <div className="user-row">
                      <div>
                        <strong>{user.username}</strong>
                        <p className="muted-line">Role: {user.role === 'admin' ? 'Admin' : 'User'}</p>
                        {user.createdAt ? (
                          <p className="muted-line">Created: {new Date(user.createdAt).toLocaleString()}</p>
                        ) : null}
                      </div>
                      <div className="user-row-actions">
                        <button
                          className="setup-icon-button setup-icon-button-neutral"
                          onClick={() => openChangePasswordModal(user.username)}
                          title="Change Password"
                          aria-label={`Change password for ${user.username}`}
                        >
                          <IconFingerprint />
                        </button>
                        <button
                          className="setup-icon-button setup-icon-button-danger"
                          onClick={() => handleDeleteUser(user.username)}
                          title="Remove User"
                          aria-label={`Remove ${user.username}`}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </section>
        ) : null
      ) : null}

      {addUserModalOpen ? (
        <div
          className="scheme-modal-backdrop"
          onClick={() => {
            setAddUserModalOpen(false);
            setAddUserNotice({ tone: 'pending', text: '' });
          }}
        >
          <section className="scheme-modal add-user-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Add User</h4>
              <ModalCloseButton
                onClick={() => {
                  setAddUserModalOpen(false);
                  setAddUserNotice({ tone: 'pending', text: '' });
                }}
              />
            </div>
            <section className="grid three-col">
              <label>
                Username
                <input
                  type="text"
                  value={userDraft.username}
                  onChange={(e) => updateUserDraft('username', e.target.value)}
                />
              </label>
              <label>
                Role
                <select
                  value={userDraft.role}
                  onChange={(e) => updateUserDraft('role', e.target.value)}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </section>
            <section className="add-user-password-line" style={{ marginTop: 12 }}>
              <div className="add-user-password-field">
                <span className="add-user-password-label">Password</span>
                <PasswordField
                  value={userDraft.password}
                  onChange={(e) => updateUserDraft('password', e.target.value)}
                />
              </div>
              <div className="add-user-inline-status">
                <span className="add-user-status-label-spacer" aria-hidden="true">Password</span>
                <ResultBanner
                  tone={
                    !userDraft.password
                      ? 'pending'
                      : userDraft.password.length >= 8
                        ? 'success'
                        : 'error'
                  }
                  text={
                    !userDraft.password
                      ? 'Password must be at least 8 characters.'
                      : userDraft.password.length >= 8
                      ? 'Password length is valid.'
                      : 'Password must be at least 8 characters.'
                  }
                />
              </div>
            </section>
            <section className="add-user-password-line" style={{ marginTop: 12 }}>
              <div className="add-user-password-field">
                <span className="add-user-password-label">Confirm Password</span>
                <PasswordField
                  value={userDraft.confirmPassword}
                  onChange={(e) => updateUserDraft('confirmPassword', e.target.value)}
                />
              </div>
              <div className="add-user-inline-status">
                <span className="add-user-status-label-spacer" aria-hidden="true">Confirm Password</span>
                <ResultBanner
                  tone={
                    !userDraft.password && !userDraft.confirmPassword
                      ? 'pending'
                      : userDraft.password && userDraft.confirmPassword && userDraft.password === userDraft.confirmPassword
                      ? 'success'
                      : 'error'
                  }
                  text={
                    !userDraft.password && !userDraft.confirmPassword
                      ? 'Passwords must match.'
                      : userDraft.password && userDraft.confirmPassword && userDraft.password === userDraft.confirmPassword
                      ? 'Passwords match.'
                      : 'Passwords do not match.'
                  }
                />
              </div>
            </section>
            {addUserNotice.text ? <ResultBanner tone={addUserNotice.tone} text={addUserNotice.text} /> : null}
            <div className="button-row add-user-actions">
              <button className="button-primary" onClick={handleAddUser} disabled={usersLoading}>
                {usersLoading ? 'Working…' : 'Add User'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {changePasswordModal.open ? (
        <div
          className="scheme-modal-backdrop"
          onClick={closeChangePasswordModal}
        >
          <section className="scheme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Change Password</h4>
              <ModalCloseButton onClick={closeChangePasswordModal} />
            </div>
            <p>
              User: <strong>{changePasswordModal.username}</strong>
            </p>
            <section className="password-status-line" style={{ marginTop: 12 }}>
              <div className="password-status-field">
                <span className="password-status-label">New Password</span>
                <PasswordField
                  value={changePasswordModal.password}
                  onChange={(e) => {
                    setChangePasswordNotice({ tone: 'pending', text: '' });
                    setChangePasswordModal((current) => ({
                      ...current,
                      password: e.target.value
                    }));
                  }}
                />
              </div>
              <div className="password-inline-status">
                <span className="password-status-label-spacer" aria-hidden="true">New Password</span>
                <ResultBanner
                  tone={userPasswordLengthTone}
                  text={
                    isUserPasswordLengthValid
                      ? 'Password length is valid.'
                      : 'Password must be at least 8 characters.'
                  }
                />
              </div>
            </section>
            <section className="password-status-line" style={{ marginTop: 12 }}>
              <div className="password-status-field">
                <span className="password-status-label">Confirm Password</span>
                <PasswordField
                  value={changePasswordModal.confirmPassword}
                  onChange={(e) => {
                    setChangePasswordNotice({ tone: 'pending', text: '' });
                    setChangePasswordModal((current) => ({
                      ...current,
                      confirmPassword: e.target.value
                    }));
                  }}
                />
              </div>
              <div className="password-inline-status">
                <span className="password-status-label-spacer" aria-hidden="true">Confirm Password</span>
                <ResultBanner
                  tone={userPasswordMatchTone}
                  text={isUserPasswordMatchValid ? 'Passwords match.' : 'Passwords must match.'}
                />
              </div>
            </section>
            {changePasswordNotice.text ? (
              <ResultBanner tone={changePasswordNotice.tone} text={changePasswordNotice.text} />
            ) : null}
            <div className="button-row" style={{ marginTop: 12 }}>
              <button
                className="button-primary"
                onClick={handleChangeUserPassword}
                disabled={!canSubmitUserPasswordChange}
              >
                {changePasswordLoading ? 'Working…' : 'Change'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {firstUserModalOpen ? (
        <div
          className="scheme-modal-backdrop"
          onClick={() => {
            setFirstUserModalOpen(false);
            setFirstUserNotice({ tone: 'pending', text: '' });
          }}
        >
          <section className="scheme-modal add-user-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Create Admin User</h4>
              <ModalCloseButton
                onClick={() => {
                  setFirstUserModalOpen(false);
                  setFirstUserNotice({ tone: 'pending', text: '' });
                }}
              />
            </div>
            <p>
              Authentication requires at least one admin user.
            </p>
            <section className="grid three-col">
              <label>
                Username
                <input
                  type="text"
                  value={firstUserDraft.username}
                  onChange={(e) => updateFirstUserDraft('username', e.target.value)}
                />
              </label>
              <label>
                Role
                <select value="admin" disabled>
                  <option value="admin">Admin</option>
                </select>
              </label>
            </section>
            <section className="add-user-password-line" style={{ marginTop: 12 }}>
              <div className="add-user-password-field">
                <span className="add-user-password-label">Password</span>
                <PasswordField
                  value={firstUserDraft.password}
                  onChange={(e) => updateFirstUserDraft('password', e.target.value)}
                />
              </div>
              <div className="add-user-inline-status">
                <span className="add-user-status-label-spacer" aria-hidden="true">Password</span>
                <ResultBanner
                  tone={firstUserPasswordLengthTone}
                  text={
                    isFirstUserPasswordLengthValid
                      ? 'Password length is valid.'
                      : 'Password must be at least 8 characters.'
                  }
                />
              </div>
            </section>
            <section className="add-user-password-line" style={{ marginTop: 12 }}>
              <div className="add-user-password-field">
                <span className="add-user-password-label">Confirm Password</span>
                <PasswordField
                  value={firstUserDraft.confirmPassword}
                  onChange={(e) => updateFirstUserDraft('confirmPassword', e.target.value)}
                />
              </div>
              <div className="add-user-inline-status">
                <span className="add-user-status-label-spacer" aria-hidden="true">Confirm Password</span>
                <ResultBanner
                  tone={firstUserPasswordMatchTone}
                  text={isFirstUserPasswordMatchValid ? 'Passwords match.' : 'Passwords must match.'}
                />
              </div>
            </section>
            {firstUserNotice.text ? (
              <ResultBanner tone={firstUserNotice.tone} text={firstUserNotice.text} />
            ) : null}
            <div className="button-row add-user-actions">
              <button
                className="button-primary"
                onClick={handleCreateFirstUserAndEnableAuth}
                disabled={usersLoading}
              >
                {usersLoading ? 'Working…' : 'Create Admin and Enable Auth'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {loadConfigModal.open ? (
        <div
          className="scheme-modal-backdrop"
          onClick={() => setLoadConfigModal({ open: false, mode: 'menu', loading: false, configs: [] })}
        >
          <section
            className={`scheme-modal load-config-modal${loadConfigModal.mode === 'menu' ? ' load-config-modal-menu' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <h4>Load Config</h4>
              <div className="modal-header-actions">
                {loadConfigModal.mode === 'stored' ? (
                  <button
                    className="setup-icon-button setup-icon-button-neutral"
                    onClick={() => setLoadConfigModal((current) => ({ ...current, mode: 'menu' }))}
                    title="Back"
                    aria-label="Back"
                  >
                    <CaretCircleLeft size={20} weight="duotone" aria-hidden="true" />
                  </button>
                ) : null}
                <ModalCloseButton onClick={() => setLoadConfigModal({ open: false, mode: 'menu', loading: false, configs: [] })} />
              </div>
            </div>

            {loadConfigModal.mode === 'menu' ? (
              <div className="button-row load-config-menu-actions">
                <button
                  className="setup-icon-button setup-icon-button-neutral setup-config-action-button"
                  onClick={() => uploadConfigInputRef.current?.click()}
                >
                  <UploadSimple size={18} weight="duotone" aria-hidden="true" />
                  <span>Upload Config</span>
                </button>
                <button
                  className="setup-icon-button setup-icon-button-neutral setup-config-action-button"
                  onClick={showStoredConfigsInModal}
                  disabled={loadConfigModal.loading}
                >
                  <FolderOpen size={18} weight="duotone" aria-hidden="true" />
                  <span>{loadConfigModal.loading ? 'Loading…' : 'Load Stored Config'}</span>
                </button>
              </div>
            ) : (
              <>
                {loadConfigModal.loading ? <p style={{ marginTop: 10 }}>Loading configs…</p> : null}
                {!loadConfigModal.loading && !loadConfigModal.configs.length ? (
                  <p style={{ marginTop: 10 }}>No stored configs found</p>
                ) : null}
                {!loadConfigModal.loading && loadConfigModal.configs.length ? (
                  <ul className="entry-list" style={{ marginTop: 10 }}>
                    {loadConfigModal.configs.map((item) => (
                      <li key={item.name}>
                        <div className="user-row">
                          <div>
                            <strong>{item.name}</strong>
                            <p className="muted-line">
                              Modified: {item.modifiedAt ? new Date(item.modifiedAt).toLocaleString() : '—'}
                            </p>
                          </div>
                          <button
                            className="button-primary"
                            onClick={() => handleLoadStoredConfig(item.name)}
                            disabled={loadConfigModal.loading}
                          >
                            Load
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </section>
        </div>
      ) : null}

      {clearConfigModalOpen ? (
        <div className="scheme-modal-backdrop" onClick={() => setClearConfigModalOpen(false)}>
          <section className="scheme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Clear Configuration</h4>
              <ModalCloseButton onClick={() => setClearConfigModalOpen(false)} />
            </div>
            <p>Load the default empty configuration? Locally stored config files will be kept.</p>
            <div className="button-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="clear-with-keys-button" onClick={openClearConfigAndKeysModal} disabled={saving}>
                {saving ? 'Working…' : 'Load Default + Clear SSH Keys'}
              </button>
              <button className="button-primary" onClick={() => handleClearConfig()} disabled={saving}>
                {saving ? 'Clearing…' : 'Load Default'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {saveConfigModal.open ? (
        <div
          className="scheme-modal-backdrop"
          onClick={() => setSaveConfigModal({ open: false, name: 'config' })}
        >
          <section className="scheme-modal save-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Save Config</h4>
              <ModalCloseButton onClick={() => setSaveConfigModal({ open: false, name: 'config' })} />
            </div>
            <p className="muted-line save-config-note">Saved configs do not include SSH keys.</p>
            <div className="save-config-row">
              <label className="save-config-name-label">
              Config Name
              <input
                type="text"
                value={saveConfigModal.name}
                onChange={(e) =>
                  setSaveConfigModal((current) => ({ ...current, name: e.target.value }))
                }
                placeholder="config"
              />
              </label>
              <button className="button-primary" onClick={handleSaveConfigFromModal} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {clearKeysModal.open ? (
        <div
          className="scheme-modal-backdrop"
          onClick={() =>
            setClearKeysModal({
              open: false,
              storagePassword: '',
              workingPassword: '',
              notice: { tone: 'pending', text: '' }
            })
          }
        >
          <section className="scheme-modal save-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Clear SSH Keys</h4>
              <ModalCloseButton
                onClick={() =>
                  setClearKeysModal({
                    open: false,
                    storagePassword: '',
                    workingPassword: '',
                    notice: { tone: 'pending', text: '' }
                  })
                }
              />
            </div>
            <p className="clear-keys-description">
              Enter passwords to verify and remove SSH keys from storage, working location, and container.
            </p>
            <label style={{ marginTop: 12 }}>
              Storage Location {form.storageLocation.username ? `${form.storageLocation.username} ` : ''}Password
              <PasswordField
                value={clearKeysModal.storagePassword}
                onChange={(e) =>
                  setClearKeysModal((current) => ({ ...current, storagePassword: e.target.value }))
                }
              />
            </label>
            <label style={{ marginTop: 12 }}>
              {(currentWorkingLocation?.name || 'Working Location')} {currentWorkingLocation?.username ? `${currentWorkingLocation.username} ` : ''}Password
              <PasswordField
                value={clearKeysModal.workingPassword}
                onChange={(e) =>
                  setClearKeysModal((current) => ({ ...current, workingPassword: e.target.value }))
                }
              />
            </label>
            {clearKeysModal.notice.text ? (
              <ResultBanner tone={clearKeysModal.notice.tone} text={clearKeysModal.notice.text} />
            ) : null}
            <div className="button-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <button className="button-primary" onClick={handleClearConfigAndKeys} disabled={saving}>
                {saving ? 'Working…' : 'Clear Keys + Load Default'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {clearKnownHostsModal.open ? (
        <div
          className="scheme-modal-backdrop"
          onClick={() => setClearKnownHostsModal({ open: false, host: '', label: '', side: 'storage' })}
        >
          <section className="scheme-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Clear Known Hosts</h4>
            </div>
            <p>
              Remove the saved host key for <strong>{clearKnownHostsModal.label}</strong>
              {clearKnownHostsModal.host ? ` (${clearKnownHostsModal.host})` : ''} from the container known_hosts?
            </p>
            <div className="button-row" style={{ marginTop: 12 }}>
              <button onClick={() => setClearKnownHostsModal({ open: false, host: '', label: '', side: 'storage' })}>
                Cancel
              </button>
              <button
                className="button-primary"
                onClick={async () => {
                  await handleClearContainerKnownHostsForHost(
                    clearKnownHostsModal.host,
                    clearKnownHostsModal.label || 'Location',
                    clearKnownHostsModal.side || 'storage'
                  );
                  setClearKnownHostsModal({ open: false, host: '', label: '', side: 'storage' });
                }}
                disabled={saving}
              >
                {saving ? 'Clearing…' : 'Clear'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function StatusPill({ tone, label, className = '' }) {
  return <span className={`status-pill ${tone} ${className}`.trim()}>{label}</span>;
}

function ResultBanner({ tone, text }) {
  return <div className={`result-banner ${tone}`}>{text}</div>;
}

function LabelWithInfo({ label, info }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="label-with-info">
      <span>{label}</span>
      <button
        type="button"
        className="label-info-button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        aria-label={`${label} info`}
        title="Info"
      >
        <Info size={14} weight="duotone" aria-hidden="true" />
      </button>
      {open ? <span className="label-info-popover">{info}</span> : null}
    </span>
  );
}

function InfoIconWithPopover({ info }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="label-with-info">
      <button
        type="button"
        className="label-info-button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        aria-label="Info"
        title="Info"
      >
        <Info size={14} weight="duotone" aria-hidden="true" />
      </button>
      {open ? <span className="label-info-popover">{info}</span> : null}
    </span>
  );
}

function ModalCloseButton({ onClick }) {
  return (
    <button
      className="setup-icon-button setup-icon-button-danger"
      onClick={onClick}
      title="Close"
      aria-label="Close"
    >
      <XCircle size={20} weight="duotone" aria-hidden="true" />
    </button>
  );
}

function PasswordField({ value, onChange }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-row">
      <input type={visible ? 'text' : 'password'} value={value} onChange={onChange} />
      <button
        type="button"
        className="password-visibility-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <IconEye /> : <IconEyeOff />}
      </button>
    </div>
  );
}

function IconSave() {
  return <FloppyDiskBack size={20} weight="duotone" aria-hidden="true" />;
}

function IconTrash() {
  return <Trash size={20} weight="duotone" aria-hidden="true" />;
}

function IconFingerprint() {
  return <Fingerprint size={20} weight="duotone" aria-hidden="true" />;
}

function IconEye() {
  return <Eye size={20} weight="duotone" aria-hidden="true" />;
}

function IconEyeOff() {
  return <EyeClosed size={20} weight="duotone" aria-hidden="true" />;
}
