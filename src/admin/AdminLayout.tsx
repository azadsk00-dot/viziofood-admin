/**
 * Admin shell — sidebar navigation grouped by workflow (operate / menu /
 * grow / system), profile block, sign-out. Responsive: sidebar slides in
 * over content on narrow screens.
 */

import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Box,
  ClipboardList,
  Image,
  LayoutDashboard,
  Menu,
  Printer,
  Settings,
  Shapes,
  Sparkles,
  ScrollText,
  Star,
  Tag,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthProvider';

const groups = [
  {
    label: 'Operate',
    items: [
      ['/admin', 'Dashboard', LayoutDashboard],
      ['/admin/orders', 'Orders', ClipboardList],
      ['/admin/printers', 'Printers', Printer],
    ],
  },
  {
    label: 'Menu',
    items: [
      ['/admin/products', 'Products', Box],
      ['/admin/categories', 'Categories', Box],
      ['/admin/modifiers', 'Modifiers', Shapes],
    ],
  },
  {
    label: 'Grow',
    items: [
      ['/admin/specials', 'Specials', Sparkles],
      ['/admin/coupons', 'Coupons', Tag],
      ['/admin/featured', 'Featured', Star],
      ['/admin/branding', 'Branding', Image],
      ['/admin/customers', 'Customers', Users],
      ['/admin/reports', 'Reports', BarChart3],
    ],
  },
  {
    label: 'System',
    items: [
      ['/admin/audit', 'Audit log', ScrollText],
      ['/admin/settings', 'Settings', Settings],
    ],
  },
] as const;

export default function AdminLayout() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();

  const logout = async () => {
    setBusy(true);
    try {
      await signOut();
      navigate('/admin/login', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${open ? 'is-open' : ''}`}>
        <Link to="/admin" className="admin-sidebar__brand">
          Vizio <em style={{ fontStyle: 'italic', color: 'var(--gold)' }}>Admin</em>
        </Link>
        <nav className="admin-sidebar__nav" aria-label="Admin navigation">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="admin-sidebar__section">{group.label}</div>
              {group.items.map(([to, label, Icon]) => (
                <NavLink
                  end={to === '/admin'}
                  onClick={() => setOpen(false)}
                  key={to}
                  to={to}
                  className={({ isActive }) => `admin-sidebar__link ${isActive ? 'is-active' : ''}`}
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar__foot">
          <div className="admin-sidebar__user">
            <span className="admin-sidebar__avatar">{profile?.full_name?.slice(0, 2).toUpperCase() || 'VF'}</span>
            <span>
              {profile?.full_name || 'Vizio Food'}
              <br />
              <span style={{ opacity: 0.7, fontSize: '0.75rem' }}>{profile?.role ?? 'admin'}</span>
            </span>
          </div>
          <button className="vz-btn vz-btn--ghost vz-btn--sm vz-btn--block" style={{ color: 'var(--admin-sidebar-ink)' }} disabled={busy} onClick={() => void logout()}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="vz-row" style={{ marginBottom: 14 }}>
          <button className="admin-burger" type="button" onClick={() => setOpen(!open)} aria-label="Toggle admin navigation">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
