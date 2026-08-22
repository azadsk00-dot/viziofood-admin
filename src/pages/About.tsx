/**
 * Our Story — static brand narrative with settings-driven visit block.
 */

import { Leaf, Utensils, Users, MapPin, Phone, Clock } from 'lucide-react';
import hero from '../assets/hero-pasta.webp';
import { useRestaurantSettings, formatOpeningHours } from '../hooks/useRestaurantSettings';
import { Card } from '../ui';

const timeline = [
  { year: '2014', body: 'Vizio opens with six tables and one hand-cranked pasta machine.' },
  { year: '2019', body: 'Our coffee bar arrives, making mornings our new favourite ritual.' },
  { year: 'Today', body: 'A daily, joyful meeting place for our beautiful neighbourhood.' },
];

const values = [
  { icon: Leaf, title: 'Real ingredients', body: 'We know our producers and let each ingredient shine.' },
  { icon: Utensils, title: 'Italian technique', body: 'Classic methods, faithfully practised every day.' },
  { icon: Users, title: 'Open table', body: 'Good food tastes best when it is shared.' },
];

export default function About() {
  const { settings } = useRestaurantSettings();
  const addressLine = settings ? [settings.address, settings.suburb, settings.state, settings.postcode].filter(Boolean).join(', ') : '';
  const hours = settings ? formatOpeningHours(settings.openingHours) : [];

  return (
    <>
      <section className="hero">
        <div className="vz-container hero__grid">
          <div>
            <p className="vz-eyebrow">Our story</p>
            <h1>
              A table for <em>everybody.</em>
            </h1>
            <p className="hero__lead">
              Vizio began with a tiny pasta machine, a big idea, and a belief that great food should feel generous.
            </p>
          </div>
          <div className="hero__image">
            <img src={hero} alt="Fresh pasta plated at Vizio Food" />
          </div>
        </div>
      </section>

      <section className="vz-section vz-container" style={{ maxWidth: 760 }}>
        <p className="vz-eyebrow">A decade in the making</p>
        <h2>Italian comfort, with a Western Australian soul.</h2>
        <p className="vz-muted">
          We make pasta the old way: with good flour, free-range eggs and plenty of patience. Our recipes travel from
          the villages of Italy to our sunny little corner of {settings?.suburb || 'Leederville'}, with room for the
          local seasons to speak.
        </p>
      </section>

      <section className="vz-section vz-container">
        <div className="menu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {timeline.map((entry) => (
            <Card key={entry.year} pad>
              <div className="vz-eyebrow" style={{ marginBottom: 6 }}>{entry.year}</div>
              <p style={{ marginBottom: 0 }}>{entry.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="vz-section vz-container">
        <div className="menu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {values.map(({ icon: Icon, title, body }) => (
            <Card key={title} pad>
              <Icon size={26} color="var(--terracotta)" />
              <h3 style={{ marginTop: 12 }}>{title}</h3>
              <p className="vz-muted" style={{ marginBottom: 0 }}>{body}</p>
            </Card>
          ))}
        </div>
      </section>

      {settings && (addressLine || settings.phone || hours.length > 0) && (
        <section className="vz-section vz-container" style={{ maxWidth: 640 }}>
          <p className="vz-eyebrow">Visit us</p>
          <h2>Find your way to the table.</h2>
          <div className="vz-stack">
            {addressLine && (
              <p className="vz-row">
                <MapPin size={17} />
                {settings.googleMapsUrl ? (
                  <a href={settings.googleMapsUrl} target="_blank" rel="noreferrer">{addressLine}</a>
                ) : (
                  addressLine
                )}
              </p>
            )}
            {settings.phone && (
              <p className="vz-row">
                <Phone size={17} />
                <a href={`tel:${settings.phone.replace(/\s/g, '')}`}>{settings.phone}</a>
              </p>
            )}
            {hours.map((line) => (
              <p className="vz-row" key={line}>
                <Clock size={17} /> {line}
              </p>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
