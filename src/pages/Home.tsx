/**
 * Homepage — hero, live Special of the Day (specials entity with the legacy
 * homepage promo as fallback), featured dishes, perks, coffee and CTA.
 * Everything admin-controlled streams in via realtime hooks.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Coffee, Heart, Leaf, Award } from 'lucide-react';
import { motion } from 'framer-motion';
import hero from '../assets/hero-pasta.webp';
import { useRestaurantSettings, formatOpeningHours } from '../hooks/useRestaurantSettings';
import { useFeaturedDishes } from '../hooks/useFeaturedDishes';
import { useHomepagePromo } from '../hooks/useHomepagePromo';
import { getSpecials } from '../services/specials';
import { resolveActiveSpecial } from '../lib/specials';
import type { Special } from '../types';
import { Badge, Button, Card, Skeleton } from '../ui';
import { aud } from '../lib/money';

const perks = [
  { icon: Leaf, title: 'From scratch', body: 'Fresh pasta rolled each morning.' },
  { icon: Award, title: 'Italian at heart', body: 'Recipes built on restraint.' },
  { icon: Coffee, title: 'Coffee, properly', body: 'A daily roast worth lingering for.' },
  { icon: Heart, title: 'Made for gathering', body: 'The table is always open.' },
];

/** New specials entity first; the legacy promo remains the fallback. */
function useActiveSpecial() {
  const [special, setSpecial] = useState<Special | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getSpecials()
      .then((all) => {
        if (!cancelled) setSpecial(resolveActiveSpecial(all));
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);
  return { special, loaded };
}

function SpecialBanner() {
  const { special, loaded } = useActiveSpecial();
  const { promo } = useHomepagePromo();

  if (special) {
    return (
      <section className="vz-container" style={{ marginBottom: 'var(--vz-section-gap, 0)' }} aria-label="Special of the day">
        <div className="special-banner">
          {special.badge && <span className="special-banner__badge">{special.badge}</span>}
          <div>
            <div className="special-banner__eyebrow">Special of the day</div>
            <h2>{special.title}</h2>
            <p>{special.description}</p>
            <div className="special-banner__pricing">
              <span className="special-banner__price">{aud(special.price)}</span>
              {special.originalPrice && special.originalPrice > special.price && (
                <span className="special-banner__was">{aud(special.originalPrice)}</span>
              )}
              {special.discountPercent && <Badge tone="gold">−{special.discountPercent}%</Badge>}
            </div>
            {special.ctaText && (
              <Button variant="gold" onClick={() => {
                const link = special.ctaLink || '/menu';
                if (link.startsWith('/')) window.location.assign(link);
                else window.open(link, '_blank', 'noopener');
              }}>
                {special.ctaText} <ArrowRight size={17} />
              </Button>
            )}
          </div>
          {special.imageUrl && (
            <div className="special-banner__image">
              <img src={special.imageUrl} alt={special.title} />
            </div>
          )}
        </div>
      </section>
    );
  }

  // Fallback: legacy admin-managed promo (homepage_content). The hook only
  // returns the row when enabled and in its date window.
  if (loaded && promo?.title) {
    return (
      <section className="vz-container" aria-label="Special offer">
        <div className="special-banner">
          <div>
            <div className="special-banner__eyebrow">{promo.promoType === 'weekly' ? 'This week' : 'Today only'}</div>
            <h2>{promo.title}</h2>
            <p>{promo.description}</p>
            {promo.price !== null && <div className="special-banner__pricing"><span className="special-banner__price">{aud(promo.price)}</span></div>}
            {promo.buttonText && (
              <Button variant="gold" onClick={() => {
                const link = promo.buttonLink || '/menu';
                if (link.startsWith('/')) window.location.assign(link);
                else window.open(link, '_blank', 'noopener');
              }}>
                {promo.buttonText} <ArrowRight size={17} />
              </Button>
            )}
          </div>
          {promo.imageUrl && <div className="special-banner__image"><img src={promo.imageUrl} alt={promo.title} /></div>}
        </div>
      </section>
    );
  }
  return null;
}

function FeaturedGrid() {
  const { dishes, loading } = useFeaturedDishes();
  if (loading) {
    return (
      <div className="menu-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="menu-item">
            <Skeleton height={180} style={{ borderRadius: 0 }} />
            <div style={{ padding: 16 }}>
              <Skeleton height={20} width="70%" />
              <Skeleton height={14} width="90%" style={{ marginTop: 8 }} />
            </div>
          </Card>
        ))}
      </div>
    );
  }
  if (!dishes.length) return null;
  return (
    <div className="menu-grid">
      {dishes.map((dish, index) => (
        <motion.div
          key={dish.id}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: index * 0.05 }}
        >
          <Card className="menu-item">
            <div className="menu-item__image">
              {dish.imageUrl && <img src={dish.imageUrl} alt={dish.name} loading="lazy" />}
            </div>
            <div className="menu-item__body">
              <div className="menu-item__name">{dish.name}</div>
              <div className="menu-item__desc">{dish.description}</div>
              <div className="menu-item__foot">
                <span className="menu-item__price">{aud(dish.price)}</span>
                <Link className="vz-btn vz-btn--secondary vz-btn--sm" to="/menu">Order</Link>
              </div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

export default function Home() {
  const { settings } = useRestaurantSettings();
  const todayHours = useMemo(() => {
    if (!settings) return null;
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return formatOpeningHours(settings.openingHours)[keys.indexOf(keys[new Date().getDay()])] ?? null;
  }, [settings]);

  return (
    <>
      <section className="hero">
        <div className="vz-container hero__grid">
          <div>
            <p className="vz-eyebrow">{settings?.suburb || 'Leederville'}, Perth</p>
            <h1>
              Fresh pasta, <em>made with intention.</em>
            </h1>
            <p className="hero__lead">
              Seasonal ingredients, Italian technique, no unnecessary fuss — rolled, cut and plated every day.
            </p>
            <div className="hero__cta">
              <Link to="/menu" className="vz-btn vz-btn--primary vz-btn--lg">
                Order now <ArrowRight size={18} />
              </Link>
              <Link to="/about" className="vz-btn vz-btn--secondary vz-btn--lg">Our story</Link>
            </div>
            <div className="hero__meta">
              <span><b>Today:</b> {todayHours ?? 'See hours'}</span>
              <span><b>Ordering:</b> {settings ? (settings.ordersEnabled ? 'Open' : 'Paused') : '…'}</span>
              {settings?.phone && <span><b>Call:</b> {settings.phone}</span>}
            </div>
          </div>
          <div className="hero__image">
            <img src={hero} alt="Fresh pasta plated at Vizio Food" />
          </div>
        </div>
      </section>

      <div style={{ marginTop: 'clamp(-30px, -4vw, -12px)', paddingBottom: 8 }}>
        <SpecialBanner />
      </div>

      <section className="vz-section vz-container">
        <p className="vz-eyebrow">House favourites</p>
        <h2>The plates people come back for.</h2>
        <FeaturedGrid />
      </section>

      <section className="vz-section vz-container">
        <div className="menu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {perks.map(({ icon: Icon, title, body }) => (
            <Card key={title} pad>
              <Icon size={26} color="var(--terracotta)" />
              <h3 style={{ marginTop: 12 }}>{title}</h3>
              <p className="vz-muted" style={{ marginBottom: 0 }}>{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="vz-section vz-container" style={{ textAlign: 'center', maxWidth: 720 }}>
        <p className="vz-eyebrow">Slow down</p>
        <h2>Coffee that deserves the cup it's in.</h2>
        <p className="vz-muted">
          A daily roast, pulled properly. Stay for one — the table is always open.
        </p>
        <Link to="/menu" className="vz-btn vz-btn--primary vz-btn--lg">
          See the menu <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
