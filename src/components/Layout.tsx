/**
 * Public site chrome: navbar (with live cart badge + drawer), orders-paused
 * banner, footer (settings-driven), and the cart drawer itself. All data
 * comes from the realtime settings hook — an admin change propagates here
 * without a redeploy.
 */

import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, Trash2, Menu as MenuIcon } from 'lucide-react';
import { useRestaurantSettings, formatOpeningHours } from '../hooks/useRestaurantSettings';
import { useCart } from '../context/CartProvider';
import { Button, Drawer } from '../ui';
import { aud } from '../lib/money';

export function Navbar() {
  const { settings } = useRestaurantSettings();
  const { count, openDrawer } = useCart();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="site-header">
      <div className="vz-container site-header__inner">
        <Link to="/" className="site-logo" aria-label={settings ? `${settings.name} home` : 'Vizio Food home'}>
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} alt={settings.name || 'Vizio Food'} />
          ) : (
            <span className="site-logo__word">Vizio Food</span>
          )}
        </Link>
        <nav className={`site-nav ${navOpen ? 'is-open' : ''}`} aria-label="Primary">
          <NavLink to="/" end onClick={() => setNavOpen(false)}>Home</NavLink>
          <NavLink to="/menu" onClick={() => setNavOpen(false)}>Menu</NavLink>
          <NavLink to="/about" onClick={() => setNavOpen(false)}>Our Story</NavLink>
          <NavLink to="/account" onClick={() => setNavOpen(false)}>My account</NavLink>
          <NavLink to="/checkout" onClick={() => setNavOpen(false)}>Checkout</NavLink>
        </nav>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="site-nav__cart" onClick={openDrawer} aria-label={`Open cart (${count} items)`}>
            <ShoppingBag size={20} />
            {count > 0 && <span className="site-nav__cart-count">{count}</span>}
          </button>
          <button
            className="site-nav__burger"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            aria-label="Toggle navigation"
          >
            <MenuIcon size={20} />
          </button>
        </div>
      </div>
      <CartDrawer onCheckoutRoute={location.pathname === '/checkout'} />
    </header>
  );
}

const lineTotal = (price: number, modifiers: { price: number }[], quantity: number) =>
  (price + modifiers.reduce((sum, m) => sum + m.price, 0)) * quantity;

function CartDrawer({ onCheckoutRoute }: { onCheckoutRoute: boolean }) {
  const { cart, drawerOpen, closeDrawer, updateQuantity, removeItem, clear } = useCart();
  const navigate = useNavigate();
  const subtotal = cart.items.reduce((sum, item) => sum + Math.round(lineTotal(item.price, item.modifiers, item.quantity) * 100), 0) / 100;

  return (
    <Drawer
      open={drawerOpen}
      onClose={closeDrawer}
      title={`Your order${cart.items.length ? ` (${cart.items.length})` : ''}`}
      footer={
        cart.items.length > 0 ? (
          <div className="vz-stack">
            <div className="vz-row vz-row--between">
              <strong>Subtotal</strong>
              <strong>{aud(subtotal)}</strong>
            </div>
            <Button
              block
              size="lg"
              onClick={() => {
                closeDrawer();
                if (!onCheckoutRoute) navigate('/checkout');
              }}
            >
              {onCheckoutRoute ? 'You are at checkout' : 'Continue to checkout'}
            </Button>
            <button
              className="vz-btn vz-btn--ghost vz-btn--sm vz-btn--block"
              onClick={() => clear()}
            >
              <Trash2 size={15} /> Clear cart
            </button>
          </div>
        ) : undefined
      }
    >
      {cart.items.length === 0 ? (
        <div className="vz-empty">
          <div className="vz-empty__title">Your cart is empty</div>
          <p className="vz-muted">Fresh pasta is one tap away.</p>
          <Button variant="secondary" onClick={() => { closeDrawer(); navigate('/menu'); }}>
            Browse the menu
          </Button>
        </div>
      ) : (
        cart.items.map((item) => (
          <div className="cart-line" key={item.key}>
            <div className="cart-line__main">
              <div className="cart-line__name">{item.name}</div>
              {item.modifiers.length > 0 && (
                <div className="cart-line__mods">{item.modifiers.map((m) => m.name).join(', ')}</div>
              )}
              {item.instructions && <div className="cart-line__notes">“{item.instructions}”</div>}
              <div className="cart-line__qty" style={{ marginTop: 8 }}>
                <button onClick={() => updateQuantity(item.key, item.quantity - 1)} aria-label={`Reduce ${item.name}`}>
                  <Minus size={14} />
                </button>
                <span>{item.quantity}</span>
                <button onClick={() => updateQuantity(item.key, item.quantity + 1)} aria-label={`Add another ${item.name}`}>
                  <Plus size={14} />
                </button>
                <button
                  className="vz-btn vz-btn--ghost vz-btn--sm"
                  style={{ marginLeft: 6 }}
                  onClick={() => removeItem(item.key)}
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="cart-line__price">{aud(lineTotal(item.price, item.modifiers, item.quantity))}</div>
          </div>
        ))
      )}
    </Drawer>
  );
}

export function OrdersPausedBanner() {
  const { settings } = useRestaurantSettings();
  if (!settings || settings.ordersEnabled) return null;
  return (
    <div className="pause-banner" role="status">
      <strong>Orders paused.</strong>{' '}
      {settings.orderPauseMessage || 'We are not taking online orders right now — please check back soon.'}
    </div>
  );
}

export function Footer() {
  const { settings } = useRestaurantSettings();
  if (!settings) return null;
  const hours = formatOpeningHours(settings.openingHours);
  const addressLine = [settings.address, settings.suburb, settings.state, settings.postcode].filter(Boolean).join(', ');

  return (
    <footer className="site-footer">
      <div className="vz-container">
        <div className="site-footer__grid">
          <div>
            <div className="site-footer__brand">Vizio Food</div>
            <p style={{ marginTop: 10, maxWidth: '34ch' }}>Fresh Italian pasta. Premium coffee. Made with intention.</p>
            {settings.phone && (
              <p>
                <a href={`tel:${settings.phone.replace(/\s/g, '')}`}>{settings.phone}</a>
              </p>
            )}
          </div>
          <div>
            <h3>Visit us</h3>
            {addressLine && (
              <p>
                <a
                  href={
                    settings.googleMapsUrl ||
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {addressLine}
                </a>
              </p>
            )}
            {settings.email && (
              <p>
                <a href={`mailto:${settings.email}`}>{settings.email}</a>
              </p>
            )}
          </div>
          <div>
            <h3>Opening hours</h3>
            <div className="site-footer__hours">
              {hours.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
            {(settings.instagramUrl || settings.facebookUrl) && (
              <>
                <h3 style={{ marginTop: 18 }}>Follow along</h3>
                <p>
                  {settings.instagramUrl && (
                    <a href={settings.instagramUrl} target="_blank" rel="noreferrer">Instagram</a>
                  )}
                  {settings.instagramUrl && settings.facebookUrl && ' · '}
                  {settings.facebookUrl && (
                    <a href={settings.facebookUrl} target="_blank" rel="noreferrer">Facebook</a>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="site-footer__bottom">
          <span>© {new Date().getFullYear()} Vizio Food. Made with good ingredients.</span>
          <span>Perth, Western Australia</span>
        </div>
      </div>
    </footer>
  );
}
