import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X, ArrowUpRight, Camera, MapPin, Clock, Phone, AlertCircle, ExternalLink } from 'lucide-react';
import { useRestaurantSettings, formatOpeningHours } from '../hooks/useRestaurantSettings';

const links: ReadonlyArray<readonly [string, string]> = [['/', 'Home'], ['/menu', 'Menu'], ['/about', 'Our Story'], ['/account', 'My account'], ['/checkout', 'Checkout']];

/** Shown site-wide when an admin pauses online ordering. */
export function OrdersPausedBanner() {
  const { settings, loading } = useRestaurantSettings();
  if (loading || !settings || settings.ordersEnabled) return null;
  return <div className="orders-paused-banner" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{settings.orderPauseMessage || 'Online ordering is currently paused.'}</span></div>;
}

export function Navbar() { const [open, setOpen] = useState(false); return <header className="nav"><Link className="brand" to="/">VIZIO <i>FOOD</i></Link><nav aria-label="Primary navigation" className={open ? 'open' : ''}>{links.map(([path, label]) => <NavLink onClick={() => setOpen(false)} key={path} to={path}>{label}</NavLink>)}<Link onClick={() => setOpen(false)} className="button small" to="/checkout">Order now <ArrowUpRight size={16} aria-hidden="true" /></Link></nav><button className="menu" type="button" aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button></header>; }

export function Footer() {
  const { settings } = useRestaurantSettings();
  const name = settings?.name || 'Vizio Food';
  const addressLine = settings ? [settings.address, settings.suburb, settings.state, settings.postcode].filter(Boolean).join(', ') : '18 Oxford Street, Leederville';
  const hours = settings ? formatOpeningHours(settings.openingHours) : ['Mon–Sun · 7am–9pm'];
  return <footer>
    <div><Link className="brand" to="/">VIZIO <i>FOOD</i></Link><p>Fresh Italian pasta.<br />Premium coffee.</p></div>
    <div>
      <strong>Visit us</strong>
      {settings?.googleMapsUrl
        ? <p><a href={settings.googleMapsUrl} target="_blank" rel="noreferrer"><MapPin size={15} aria-hidden="true" />{addressLine}<ExternalLink size={11} aria-hidden="true" /></a></p>
        : <p><MapPin size={15} aria-hidden="true" />{addressLine}</p>}
      {settings?.phone && <p><a href={`tel:${settings.phone}`}><Phone size={15} aria-hidden="true" />{settings.phone}</a></p>}
      {hours.map(line => <p key={line}><Clock size={15} aria-hidden="true" />{line}</p>)}
    </div>
    <div>
      <strong>Follow along</strong>
      {settings?.instagramUrl
        ? <p><a href={settings.instagramUrl} target="_blank" rel="noreferrer"><Camera size={15} aria-hidden="true" />{settings.name || 'Instagram'}<ExternalLink size={11} aria-hidden="true" /></a></p>
        : <p><Camera size={15} aria-hidden="true" />@viziofood</p>}
      {settings?.facebookUrl && <p><a href={settings.facebookUrl} target="_blank" rel="noreferrer"><Camera size={15} aria-hidden="true" />Facebook<ExternalLink size={11} aria-hidden="true" /></a></p>}
      <p>{settings?.email || 'hello@viziofood.com'}</p>
    </div>
    <small>© {new Date().getFullYear()} {name}. Made with good ingredients.</small>
  </footer>;
}
