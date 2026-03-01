import { useState } from 'react';
import { Eye, EyeClosed, ShippingContainer } from '@phosphor-icons/react';

export default function LoginPage({ onLogin, loading, theme, onThemeChange }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage('');

    try {
      await onLogin({
        username: username.trim(),
        password
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="content">
      <header className="topbar">
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

      <section className="panel hero-panel auth-panel">
        <h2>Sign In</h2>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <label>
            Password
            <div className="password-input-row">
              <input
                type={passwordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-visibility-toggle"
                onClick={() => setPasswordVisible((current) => !current)}
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                title={passwordVisible ? 'Hide password' : 'Show password'}
              >
                {passwordVisible ? (
                  <Eye size={20} weight="duotone" aria-hidden="true" />
                ) : (
                  <EyeClosed size={20} weight="duotone" aria-hidden="true" />
                )}
              </button>
            </div>
          </label>

          <button className="button-primary" type="submit" disabled={loading}>
            {loading ? 'Signing In…' : 'Sign In'}
          </button>
        </form>

        {message ? <div className="result-banner error">{message}</div> : null}
      </section>
    </section>
  );
}
