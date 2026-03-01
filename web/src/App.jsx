import { useEffect, useMemo, useRef, useState } from 'react';
import { CaretCircleDown, Eye, EyeClosed, FolderOpen, GearSix, Repeat, ShippingContainer, XCircle } from '@phosphor-icons/react';
import BrowsePage from './pages/BrowsePage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import TemplatePage from './pages/TemplatePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { api } from './lib/api.js';

const PAGE_KEYS = {
  browse: 'browse',
  template: 'template',
  setup: 'setup'
};

const SETUP_ROUTE = '/setup';
const FIRST_RUN_WIZARD_ENABLED =
  String(import.meta.env.VITE_FIRST_RUN_WIZARD ?? 'true').toLowerCase() === 'true';

function hasConfiguredTarget(target) {
  return Boolean(target?.host?.trim() && target?.username?.trim() && target?.rootPath?.trim());
}

function isSetupComplete(config, keyStatus) {
  const storageReady =
    hasConfiguredTarget(config?.storageLocation) &&
    Boolean(config?.storageLocation?.templateDirectoryPath?.trim());

  const workingLocations = Array.isArray(config?.workingLocations) ? config.workingLocations : [];
  const selectedWorkingLocationId = config?.selectedWorkingLocationId;
  const working =
    workingLocations.find((item) => item.id === selectedWorkingLocationId) ||
    workingLocations.find((item) => item.isPrimary) ||
    workingLocations[0] ||
    null;

  const workingReady = hasConfiguredTarget(working);
  const setupState = working?.setupState || {};
  const trustReady =
    Boolean(setupState.containerAuthorized) &&
    Boolean(setupState.storageToWorking) &&
    Boolean(setupState.workingToStorage) &&
    Boolean(keyStatus?.hasContainerKey);

  return storageReady && workingReady && trustReady;
}

export default function App() {
  const [activePage, setActivePage] = useState(PAGE_KEYS.browse);
  const [pathname, setPathname] = useState(() => window.location.pathname || '/');
  const [authState, setAuthState] = useState({
    loading: true,
    authenticating: false,
    authEnabled: false,
    requiresAuth: false,
    authenticated: true,
    user: null
  });
  const [setupState, setSetupState] = useState({
    loading: true,
    complete: false
  });
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('ptsh-theme') || 'system';
    } catch {
      return 'system';
    }
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [changePasswordDraft, setChangePasswordDraft] = useState({
    password: '',
    confirmPassword: ''
  });
  const [changePasswordNotice, setChangePasswordNotice] = useState({ tone: 'pending', text: '' });
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const userMenuRef = useRef(null);
  const isOwnPasswordLengthValid = changePasswordDraft.password.length >= 8;
  const isOwnPasswordMatchValid =
    Boolean(changePasswordDraft.password) &&
    Boolean(changePasswordDraft.confirmPassword) &&
    changePasswordDraft.password === changePasswordDraft.confirmPassword;
  const canSubmitOwnPasswordChange = isOwnPasswordLengthValid && isOwnPasswordMatchValid && !changePasswordLoading;
  const ownPasswordLengthTone = changePasswordDraft.password ? (isOwnPasswordLengthValid ? 'success' : 'error') : 'pending';
  const ownPasswordMatchTone =
    !changePasswordDraft.password && !changePasswordDraft.confirmPassword
      ? 'pending'
      : isOwnPasswordMatchValid
      ? 'success'
      : !changePasswordDraft.password || !changePasswordDraft.confirmPassword
      ? 'pending'
      : 'error';

  useEffect(() => {
    try {
      localStorage.setItem('ptsh-theme', theme);
    } catch {
      // ignore
    }

    const root = document.documentElement;

    if (theme === 'system') {
      root.removeAttribute('data-theme');
      return;
    }

    root.setAttribute('data-theme', theme);
  }, [theme]);

  async function refreshAuthStatus() {
    setAuthState((current) => ({ ...current, loading: true }));
    try {
      const status = await api.getAuthStatus();
      setAuthState((current) => ({
        ...current,
        loading: false,
        authEnabled: Boolean(status.authEnabled),
        requiresAuth: Boolean(status.requiresAuth),
        authenticated: Boolean(status.authenticated),
        user: status.user || null
      }));
    } catch (error) {
      setAuthState((current) => ({
        ...current,
        loading: false,
        authEnabled: false,
        requiresAuth: false,
        authenticated: true,
        user: null
      }));
    }
  }

  useEffect(() => {
    refreshAuthStatus();

    function handleAuthInvalid() {
      refreshAuthStatus();
    }

    window.addEventListener('ptsh-auth-invalid', handleAuthInvalid);
    return () => {
      window.removeEventListener('ptsh-auth-invalid', handleAuthInvalid);
    };
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return undefined;

    function handlePointerDown(event) {
      if (!userMenuRef.current?.contains(event.target)) {
        setUserMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [userMenuOpen]);

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname || '/');
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  function navigate(path, replace = false) {
    const nextPath = path || '/';
    const currentPath = window.location.pathname || '/';
    if (currentPath === nextPath) return;

    if (replace) {
      window.history.replaceState({}, '', nextPath);
    } else {
      window.history.pushState({}, '', nextPath);
    }

    setPathname(nextPath);
  }

  async function refreshSetupStatus(options = {}) {
    const { silent = false } = options;

    if (authState.requiresAuth && !authState.authenticated) {
      setSetupState((current) => ({ ...current, loading: false }));
      return;
    }

    if (!silent) {
      setSetupState((current) => ({ ...current, loading: true }));
    }

    try {
      const [config, keyStatus] = await Promise.all([api.getConfig(), api.getSetupKeyStatus()]);
      setSetupState({
        loading: false,
        complete: isSetupComplete(config, keyStatus)
      });
    } catch {
      setSetupState({
        loading: false,
        complete: false
      });
    }
  }

  useEffect(() => {
    if (authState.loading) return;
    refreshSetupStatus();
  }, [authState.loading, authState.requiresAuth, authState.authenticated]);

  useEffect(() => {
    if (!FIRST_RUN_WIZARD_ENABLED) return;
    if (authState.loading || setupState.loading) return;
    if (authState.requiresAuth && !authState.authenticated) return;

    if (!setupState.complete && pathname !== SETUP_ROUTE) {
      navigate(SETUP_ROUTE, true);
    }
  }, [
    authState.loading,
    authState.requiresAuth,
    authState.authenticated,
    setupState.loading,
    setupState.complete,
    pathname
  ]);

  async function handleLogin(credentials) {
    setAuthState((current) => ({ ...current, authenticating: true }));
    try {
      await api.login(credentials);
      await refreshAuthStatus();
    } finally {
      setAuthState((current) => ({ ...current, authenticating: false }));
    }
  }

  async function handleLogout() {
    setUserMenuOpen(false);
    await api.logout();
    await refreshAuthStatus();
  }

  function openChangePasswordModal() {
    setChangePasswordDraft({
      password: '',
      confirmPassword: ''
    });
    setChangePasswordNotice({ tone: 'pending', text: '' });
    setChangePasswordModalOpen(true);
    setUserMenuOpen(false);
  }

  function closeChangePasswordModal() {
    setChangePasswordModalOpen(false);
    setChangePasswordNotice({ tone: 'pending', text: '' });
  }

  async function handleChangeOwnPassword() {
    try {
      if (changePasswordDraft.password !== changePasswordDraft.confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (changePasswordDraft.password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      setChangePasswordLoading(true);
      setChangePasswordNotice({ tone: 'pending', text: '' });
      await api.changeOwnPassword(changePasswordDraft.password);
      closeChangePasswordModal();
    } catch (error) {
      setChangePasswordNotice({ tone: 'error', text: error.message });
    } finally {
      setChangePasswordLoading(false);
    }
  }

  const navItems = useMemo(
    () => [
      { key: PAGE_KEYS.browse, label: 'Restore | Backup Session', Icon: Repeat },
      { key: PAGE_KEYS.template, label: 'New Session', Icon: FolderOpen }
    ],
    []
  );
  const canAccessSettings = !authState.authEnabled || authState.user?.role === 'admin';

  useEffect(() => {
    if (activePage === PAGE_KEYS.setup && !canAccessSettings) {
      setActivePage(PAGE_KEYS.browse);
    }
  }, [activePage, canAccessSettings]);

  function renderPage() {
    if (FIRST_RUN_WIZARD_ENABLED && pathname === SETUP_ROUTE) {
      return (
        <SetupPage
          wizardMode
          theme={theme}
          onThemeChange={setTheme}
          onWizardContinue={() => navigate('/', true)}
          onSecurityChanged={refreshAuthStatus}
          onSetupProgressChanged={() => refreshSetupStatus({ silent: true })}
        />
      );
    }

    switch (activePage) {
      case PAGE_KEYS.template:
        return <TemplatePage />;
      case PAGE_KEYS.setup:
        return (
          <SetupPage
            onSecurityChanged={refreshAuthStatus}
            onSetupProgressChanged={() => refreshSetupStatus({ silent: true })}
          />
        );
      case PAGE_KEYS.browse:
      default:
        return <BrowsePage />;
    }
  }

  return (
    <div className="app-shell">
      {authState.loading ? (
        <section className="panel">
          <h2>Loading</h2>
          <p>Checking authentication state…</p>
        </section>
      ) : authState.requiresAuth && !authState.authenticated ? (
        <LoginPage
          onLogin={handleLogin}
          loading={authState.authenticating}
          theme={theme}
          onThemeChange={setTheme}
        />
      ) : setupState.loading ? (
        <section className="panel">
          <h2>Loading</h2>
          <p>Checking setup state…</p>
        </section>
      ) : (
        <>
      {FIRST_RUN_WIZARD_ENABLED && pathname === SETUP_ROUTE ? null : (
        <>
      <header className="topbar">
        <div className="topbar-brand">
          <ShippingContainer className="topbar-logo" size={28} weight="duotone" aria-hidden="true" />
          <h1>Session Commander</h1>
        </div>

        <div className="topbar-actions">
          <div className="theme-control">
            <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Theme">
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          {canAccessSettings ? (
            <button
              className={
                activePage === PAGE_KEYS.setup
                  ? 'icon-button settings-icon-button active'
                  : 'icon-button settings-icon-button'
              }
              onClick={() => setActivePage(PAGE_KEYS.setup)}
              title="Settings"
              aria-label="Settings"
            >
              <GearSix className="settings-cog-icon" size={24} weight="duotone" aria-hidden="true" />
            </button>
          ) : null}
          {authState.authEnabled ? (
            <div className="auth-user-row" ref={userMenuRef}>
              <button
                className={userMenuOpen ? 'auth-user-menu-trigger active' : 'auth-user-menu-trigger'}
                onClick={() => setUserMenuOpen((current) => !current)}
                aria-label="User menu"
                title="User menu"
              >
                {authState.user?.username ? (
                  <span className="auth-user-label">
                    {authState.user.username}
                    <span className={`role-badge ${authState.user?.role === 'admin' ? 'admin' : 'user'}`}>
                      {authState.user?.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                  </span>
                ) : (
                  <span className="auth-user-label">User</span>
                )}
                <CaretCircleDown size={18} weight="duotone" aria-hidden="true" />
              </button>
              {userMenuOpen ? (
                <div className="auth-user-menu-dropdown">
                  <button className="auth-user-menu-item" onClick={openChangePasswordModal}>
                    Change Password
                  </button>
                  <button className="auth-user-menu-item" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <nav className="nav-row">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={activePage === item.key ? 'nav-button active' : 'nav-button'}
            onClick={() => setActivePage(item.key)}
          >
            {item.Icon ? <item.Icon size={18} weight="duotone" aria-hidden="true" /> : null}
            {item.label}
          </button>
        ))}
      </nav>
        </>
      )}

      <main className="content">{renderPage()}</main>
      {changePasswordModalOpen ? (
        <div
          className="scheme-modal-backdrop"
          onClick={closeChangePasswordModal}
        >
          <section className="scheme-modal add-user-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h4>Change Password</h4>
              <button
                className="setup-icon-button setup-icon-button-danger"
                onClick={closeChangePasswordModal}
                title="Close"
                aria-label="Close"
              >
                <XCircle size={20} weight="duotone" aria-hidden="true" />
              </button>
            </div>
            <section className="add-user-password-line" style={{ marginTop: 12 }}>
              <div className="add-user-password-field">
                <span className="add-user-password-label">New Password</span>
                <PasswordField
                  value={changePasswordDraft.password}
                  onChange={(e) => {
                    setChangePasswordNotice({ tone: 'pending', text: '' });
                    setChangePasswordDraft((current) => ({
                      ...current,
                      password: e.target.value
                    }));
                  }}
                />
              </div>
              <div className="add-user-inline-status">
                <span className="add-user-status-label-spacer" aria-hidden="true">New Password</span>
                <ResultBanner
                  tone={ownPasswordLengthTone}
                  text={
                    isOwnPasswordLengthValid
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
                  value={changePasswordDraft.confirmPassword}
                  onChange={(e) => {
                    setChangePasswordNotice({ tone: 'pending', text: '' });
                    setChangePasswordDraft((current) => ({
                      ...current,
                      confirmPassword: e.target.value
                    }));
                  }}
                />
              </div>
              <div className="add-user-inline-status">
                <span className="add-user-status-label-spacer" aria-hidden="true">Confirm Password</span>
                <ResultBanner
                  tone={ownPasswordMatchTone}
                  text={isOwnPasswordMatchValid ? 'Passwords match.' : 'Passwords must match.'}
                />
              </div>
            </section>
            {changePasswordNotice.text ? (
              <ResultBanner tone={changePasswordNotice.tone} text={changePasswordNotice.text} />
            ) : null}
            <div className="button-row add-user-actions">
              <button
                className="button-primary"
                onClick={handleChangeOwnPassword}
                disabled={!canSubmitOwnPasswordChange}
              >
                {changePasswordLoading ? 'Working…' : 'Change'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}

function ResultBanner({ tone, text }) {
  return <div className={`result-banner ${tone}`}>{text}</div>;
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
        {visible ? <Eye size={20} weight="duotone" aria-hidden="true" /> : <EyeClosed size={20} weight="duotone" aria-hidden="true" />}
      </button>
    </div>
  );
}
