/**
 * Account — sign in / register (customer accounts), recent orders with live
 * status, saved delivery address, and favourites with reorder.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, MapPin, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthProvider';
import { useCart } from '../context/CartProvider';
import { getFavourites, toggleFavourite } from '../services/customer';
import { getOrders } from '../services/orders';
import { fetchActiveProducts } from '../services/products';
import type { CustomerProduct } from '../services/products';
import type { Order } from '../types';
import { useOrdersRealtime } from '../hooks/useOrdersRealtime';
import { useCustomerNotifications, requestNotifications } from '../hooks/useCustomerNotifications';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Field, Input, orderStatusTone, Skeleton, Textarea } from '../ui';
import { aud } from '../lib/money';

function AuthPanel({ onDone }: { onDone: () => void }) {
  const { signIn, signUp, resetPassword } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        toast.show('Welcome back');
        onDone();
      } else if (mode === 'register') {
        await signUp(email, password, name);
        toast.show('Account created — welcome to the table');
        onDone();
      } else {
        await resetPassword(email, `${location.origin}/account`);
        toast.show('Reset link sent — check your inbox');
        setMode('signin');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad>
      <div className="vz-tabs" role="tablist" style={{ marginBottom: 18 }}>
        <button className={`vz-tab ${mode === 'signin' ? 'vz-tab--active' : ''}`} onClick={() => setMode('signin')} role="tab" aria-selected={mode === 'signin'}>Sign in</button>
        <button className={`vz-tab ${mode === 'register' ? 'vz-tab--active' : ''}`} onClick={() => setMode('register')} role="tab" aria-selected={mode === 'register'}>Create account</button>
      </div>
      <form onSubmit={submit} noValidate>
        {mode === 'register' && (
          <Field label="Your name" htmlFor="ac-name">
            <Input id="ac-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        )}
        <Field label="Email" htmlFor="ac-email">
          <Input id="ac-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Password" htmlFor="ac-password" hint={mode === 'register' ? 'At least 6 characters.' : undefined}>
            <Input id="ac-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </Field>
        )}
        {error && <p className="vz-field__error" role="alert">{error}</p>}
        <Button type="submit" block disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
        </Button>
        {mode === 'signin' && (
          <button type="button" className="vz-btn vz-btn--ghost vz-btn--sm vz-btn--block" style={{ marginTop: 8 }} onClick={() => setMode('forgot')}>
            Forgot password?
          </button>
        )}
      </form>
    </Card>
  );
}

export default function Account() {
  const { user, signOut } = useAuth();
  const { addItem } = useCart();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [address, setAddress] = useState(() => localStorage.getItem('vizio-saved-address') ?? '');

  const refresh = useCallback(() => {
    if (!user?.email) return;
    void getOrders(30)
      .then((all) => setOrders(all.filter((o) => o.email.toLowerCase() === user.email!.toLowerCase())))
      .catch(() => setOrders([]));
  }, [user]);

  useEffect(() => {
    refresh();
    void requestNotifications();
  }, [refresh]);

  useOrdersRealtime(refresh);
  useCustomerNotifications();

  useEffect(() => {
    void fetchActiveProducts().then(setProducts).catch(() => undefined);
    if (user) void getFavourites(user.id).then(setFavourites).catch(() => undefined);
  }, [user]);

  const favouriteProducts = useMemo(
    () => products.filter((p) => favourites.includes(p.id)),
    [products, favourites],
  );
  const recommendations = useMemo(
    () => products.filter((p) => !favourites.includes(p.id)).slice(0, 3),
    [products, favourites],
  );

  const toggle = async (productId: string) => {
    if (!user) {
      toast.show('Sign in to save favourites', { type: 'error' });
      return;
    }
    const active = !favourites.includes(productId);
    try {
      await toggleFavourite(user.id, productId, active);
      setFavourites((current) => (active ? [...current, productId] : current.filter((id) => id !== productId)));
      toast.show(active ? 'Saved to favourites' : 'Removed from favourites');
    } catch {
      toast.show('Could not update favourites', { type: 'error' });
    }
  };

  const reorder = (order: Order) => {
    let added = 0;
    for (const item of order.items) {
      const product = products.find((p) => p.id === item.id || p.name === item.name);
      if (!product) continue;
      addItem({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        modifiers: [],
        instructions: item.notes,
      });
      added += item.quantity;
    }
    if (added > 0) toast.show(`${added} item${added === 1 ? '' : 's'} added back to your cart`);
    else toast.show('Those items are no longer on the menu', { type: 'error' });
  };

  if (!user) {
    return (
      <div className="vz-container vz-section" style={{ maxWidth: 460 }}>
        <p className="vz-eyebrow">Your table</p>
        <h1 style={{ marginBottom: 20 }}>Welcome.</h1>
        <AuthPanel onDone={() => undefined} />
      </div>
    );
  }

  return (
    <div className="vz-container vz-section" style={{ paddingTop: 'clamp(28px, 5vw, 54px)' }}>
      <div className="vz-row vz-row--between" style={{ marginBottom: 26, flexWrap: 'wrap' }}>
        <div>
          <p className="vz-eyebrow">Your table</p>
          <h1 style={{ marginBottom: 0 }}>Welcome back{user.email ? `, ${user.email.split('@')[0]}` : ''}.</h1>
        </div>
        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
      </div>

      <div className="account-grid">
        <Card pad>
          <div className="vz-row vz-row--between" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Recent orders</h2>
            <button className="vz-btn vz-btn--ghost vz-btn--sm" onClick={refresh} aria-label="Refresh orders">
              <RefreshCw size={16} />
            </button>
          </div>
          {orders === null ? (
            <div className="vz-stack">
              <Skeleton height={58} />
              <Skeleton height={58} />
            </div>
          ) : orders.length === 0 ? (
            <p className="vz-muted">Your next delicious order will appear here.</p>
          ) : (
            <div className="vz-stack">
              {orders.slice(0, 5).map((order) => (
                <Card key={order.orderId} flat className="order-tile">
                  <div className="order-tile__head">
                    <strong>{order.orderNumber}</strong>
                    <Badge tone={orderStatusTone(order.status)} dot>{order.status}</Badge>
                  </div>
                  <div className="vz-row vz-row--between">
                    <span className="vz-muted">{new Date(order.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} · {order.itemsCount} items</span>
                    <strong>{aud(order.total)}</strong>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => reorder(order)}>Reorder</Button>
                </Card>
              ))}
            </div>
          )}
        </Card>

        <Card pad>
          <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>Saved details</h2>
          <Field label="Delivery address" htmlFor="ac-address">
            <Textarea
              id="ac-address"
              value={address}
              placeholder="Save a delivery address"
              onChange={(event) => {
                setAddress(event.target.value);
                localStorage.setItem('vizio-saved-address', event.target.value);
              }}
            />
          </Field>
          <p className="vz-row vz-muted" style={{ fontSize: '0.85rem' }}>
            <MapPin size={15} /> Checkout fills this in for delivery orders.
          </p>
        </Card>
      </div>

      {favouriteProducts.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <h2>Your favourites</h2>
          <div className="menu-grid">
            {favouriteProducts.map((product) => (
              <Card key={product.id} className="menu-item">
                <div className="menu-item__image">
                  {product.imageUrl && <img src={product.imageUrl} alt={product.name} loading="lazy" />}
                </div>
                <div className="menu-item__body">
                  <div className="menu-item__name">{product.name}</div>
                  <div className="menu-item__foot">
                    <span className="menu-item__price">{aud(product.price)}</span>
                    <Button size="sm" variant="secondary" onClick={() => toggle(product.id)} aria-label={`Unfavourite ${product.name}`}>
                      <Heart size={15} fill="currentColor" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {recommendations.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <h2>Recommended for you</h2>
          <div className="menu-grid">
            {recommendations.map((product) => (
              <Card key={product.id} className="menu-item">
                <div className="menu-item__image">
                  {product.imageUrl && <img src={product.imageUrl} alt={product.name} loading="lazy" />}
                </div>
                <div className="menu-item__body">
                  <div className="menu-item__name">{product.name}</div>
                  <div className="menu-item__desc">{product.description}</div>
                  <div className="menu-item__foot">
                    <span className="menu-item__price">{aud(product.price)}</span>
                    <Button size="sm" variant="ghost" onClick={() => toggle(product.id)} aria-label={`Save ${product.name} to favourites`}>
                      <Heart size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
