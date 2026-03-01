import ThemeToggle from './ThemeToggle.jsx';
import { ShippingContainer } from '@phosphor-icons/react';

const navItems = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'setup', label: 'Setup' },
  { key: 'browse', label: 'Restore | Backup Session' },
  { key: 'template', label: 'New From Template' }
];

export default function Layout({ currentPage, onNavigate, children }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <ShippingContainer className="topbar-logo" size={28} weight="duotone" aria-hidden="true" />
          <h1>Session Commander</h1>
          <p>Manage Pro Tools session movement between storage and working location.</p>
        </div>
        <ThemeToggle />
      </header>

      <nav className="nav-row">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={currentPage === item.key ? 'nav-button active' : 'nav-button'}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="content">{children}</main>
    </div>
  );
}
