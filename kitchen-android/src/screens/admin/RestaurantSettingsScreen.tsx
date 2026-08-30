// Restaurant settings — every web setting: info, opening hours per day,
// fulfilment toggles, fees/tax, ordering pause/resume with custom message.
// Saves are audit-logged and propagate to the public site via realtime.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdminPage, Card, Pill } from '../../components/admin/kit';
import { ModalSheet, NumberField, TextField, ToggleField } from '../../components/admin/fields';
import { getRestaurantSettings, saveRestaurantSettings } from '../../services/admin/settings';
import type { RestaurantSettings } from '../../lib/adminTypes';
import { useOrdersStore } from '../../state/ordersStore';
import { dark } from '../../theme';

const DAYS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' }, { key: 'sun', label: 'Sunday' },
];

export default function RestaurantSettingsScreen(): React.ReactElement {
  const online = useOrdersStore((s) => s.internetOnline);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseMessage, setPauseMessage] = useState('');
  const hoursSnapshot = useRef<string>('');
  const hoursDirty = settings !== null && JSON.stringify(settings.openingHours) !== hoursSnapshot.current;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await getRestaurantSettings();
      setSettings(loaded);
      if (loaded) hoursSnapshot.current = JSON.stringify(loaded.openingHours);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (changes: Partial<RestaurantSettings>) => {
    setBusy(true);
    setError('');
    try {
      await saveRestaurantSettings(changes);
      setMessage('Saved — the public site updates live.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const setHours = (key: string, patch: { open?: string; close?: string; closed?: boolean }) => {
    if (!settings) return;
    setSettings({
      ...settings,
      openingHours: { ...settings.openingHours, [key]: { ...settings.openingHours[key], ...patch } },
    });
  };

  if (!settings && loading) {
    return (
      <AdminPage title="Restaurant settings" loading>
        <View />
      </AdminPage>
    );
  }
  if (!settings) {
    return (
      <AdminPage title="Restaurant settings" error={error || 'No settings row found.'} onRefresh={() => void load()}>
        <View />
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="Restaurant settings"
      subtitle="Changes propagate to the public website via realtime"
      loading={loading}
      error={error}
      onRefresh={() => void load()}
      offlineBlocked={!online}
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Card title="Online ordering">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pill label={settings.ordersEnabled ? 'ACCEPTING ORDERS' : 'ORDERS PAUSED'} tone={settings.ordersEnabled ? 'good' : 'bad'} />
          <Pressable
            style={[styles.pauseButton, { borderColor: settings.ordersEnabled ? dark.danger : dark.success }]}
            disabled={busy || !online}
            onPress={() => {
              if (settings.ordersEnabled) {
                setPauseMessage(settings.orderPauseMessage);
                setPauseOpen(true);
              } else {
                void save({ ordersEnabled: true });
              }
            }}
          >
            <Text style={{ color: settings.ordersEnabled ? dark.danger : dark.success, fontWeight: '900' }}>
              {settings.ordersEnabled ? 'PAUSE ORDERING' : 'RESUME ORDERING'}
            </Text>
          </Pressable>
        </View>
        {!settings.ordersEnabled && settings.orderPauseMessage ? (
          <Text style={styles.hint}>Pause message shown to customers: “{settings.orderPauseMessage}”</Text>
        ) : null}
        <ToggleField label="Pickup enabled" value={settings.pickupEnabled} onChange={(pickupEnabled) => void save({ pickupEnabled })} />
        <ToggleField label="Delivery enabled" value={settings.deliveryEnabled} onChange={(deliveryEnabled) => void save({ deliveryEnabled })} />
        <ToggleField label="Order sound (admin browsers)" value={settings.orderSoundEnabled} onChange={(orderSoundEnabled) => void save({ orderSoundEnabled })} />
        <ToggleField label="Auto-print paid orders" value={settings.autoPrintEnabled} onChange={(autoPrintEnabled) => void save({ autoPrintEnabled })} />
      </Card>

      <Card title="Restaurant information" style={{ marginTop: 12 }}>
        <TextField label="Name" value={settings.name} onChangeText={(name) => setSettings({ ...settings, name })} />
        <TextField label="Phone" value={settings.phone} onChangeText={(phone) => setSettings({ ...settings, phone })} keyboardType="phone-pad" />
        <TextField label="Email" value={settings.email} onChangeText={(email) => setSettings({ ...settings, email })} keyboardType="email-address" />
        <TextField label="Address" value={settings.address} onChangeText={(address) => setSettings({ ...settings, address })} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><TextField label="Suburb" value={settings.suburb} onChangeText={(suburb) => setSettings({ ...settings, suburb })} /></View>
          <View style={{ flex: 1 }}><TextField label="State" value={settings.state} onChangeText={(state) => setSettings({ ...settings, state })} /></View>
          <View style={{ flex: 1 }}><TextField label="Postcode" value={settings.postcode} onChangeText={(postcode) => setSettings({ ...settings, postcode })} /></View>
        </View>
        <TextField label="Google Maps link" value={settings.googleMaps} onChangeText={(googleMaps) => setSettings({ ...settings, googleMaps })} />
        <TextField label="Instagram" value={settings.instagram} onChangeText={(instagram) => setSettings({ ...settings, instagram })} />
        <TextField label="Facebook" value={settings.facebook} onChangeText={(facebook) => setSettings({ ...settings, facebook })} />
        <Pressable style={[styles.saveButton, { opacity: busy ? 0.5 : 1 }]} disabled={busy} onPress={() => void save({
          name: settings.name, phone: settings.phone, email: settings.email, address: settings.address,
          suburb: settings.suburb, state: settings.state, postcode: settings.postcode,
          googleMaps: settings.googleMaps, instagram: settings.instagram, facebook: settings.facebook,
        })}>
          <Text style={styles.saveButtonText}>SAVE INFORMATION</Text>
        </Pressable>
      </Card>

      <Card title="Opening hours" style={{ marginTop: 12 }}>
        {DAYS.map((day) => {
          const hours = settings.openingHours[day.key] ?? { open: '11:00', close: '21:00', closed: false };
          return (
            <View key={day.key} style={styles.hoursRow}>
              <Text style={{ width: 90, color: dark.text, fontWeight: '700' }}>{day.label}</Text>
              <View style={[styles.hoursInputBox, { borderColor: hours.closed ? dark.border : dark.info }]}>
                <TextInput2 value={hours.closed ? '' : hours.open} editable={!hours.closed} onChangeText={(open) => setHours(day.key, { open })} placeholder="11:00" />
              </View>
              <Text style={{ color: dark.textDim }}>–</Text>
              <View style={[styles.hoursInputBox, { borderColor: hours.closed ? dark.border : dark.info }]}>
                <TextInput2 value={hours.closed ? '' : hours.close} editable={!hours.closed} onChangeText={(close) => setHours(day.key, { close })} placeholder="21:00" />
              </View>
              <Pressable style={[styles.closedChip, hours.closed && { backgroundColor: dark.danger, borderColor: dark.danger }]} onPress={() => setHours(day.key, { closed: !hours.closed })}>
                <Text style={{ color: hours.closed ? '#fff' : dark.textDim, fontWeight: '800', fontSize: 11 }}>{hours.closed ? 'CLOSED' : 'OPEN'}</Text>
              </Pressable>
            </View>
          );
        })}
        <Pressable
          style={[styles.saveButton, { opacity: busy || !online ? 0.5 : 1 }]}
          disabled={busy || !online}
          onPress={() => void save({ openingHours: settings.openingHours })}
        >
          <Text style={styles.saveButtonText}>SAVE HOURS</Text>
        </Pressable>
        {hoursDirty ? <Text style={styles.hint}>Unsaved hour changes.</Text> : null}
      </Card>

      <Card title="Fees, tax & timing" style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <View style={{ flexBasis: '48%' }}><NumberField label="Delivery fee (AUD)" value={String(settings.deliveryFee)} onChangeText={(deliveryFee) => setSettings({ ...settings, deliveryFee: Number(deliveryFee) || 0 })} /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Tax rate (%)" value={String(settings.taxRate)} onChangeText={(taxRate) => setSettings({ ...settings, taxRate: Number(taxRate) || 0 })} /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Service charge (%)" value={String(settings.serviceChargeRate)} onChangeText={(serviceChargeRate) => setSettings({ ...settings, serviceChargeRate: Number(serviceChargeRate) || 0 })} /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Card processing fee (%)" value={String(settings.cardFeeRate)} onChangeText={(cardFeeRate) => setSettings({ ...settings, cardFeeRate: Number(cardFeeRate) || 0 })} /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Minimum order (AUD)" value={String(settings.minimumOrder)} onChangeText={(minimumOrder) => setSettings({ ...settings, minimumOrder: Number(minimumOrder) || 0 })} /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Delivery minimum (AUD)" value={String(settings.deliveryMinimumOrder)} onChangeText={(deliveryMinimumOrder) => setSettings({ ...settings, deliveryMinimumOrder: Number(deliveryMinimumOrder) || 0 })} /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Pickup time (min)" value={String(settings.pickupTime)} onChangeText={(pickupTime) => setSettings({ ...settings, pickupTime: Number(pickupTime) || 15 })} hint="Minimum 5" /></View>
          <View style={{ flexBasis: '48%' }}><NumberField label="Delivery time (min)" value={String(settings.deliveryTime)} onChangeText={(deliveryTime) => setSettings({ ...settings, deliveryTime: Number(deliveryTime) || 35 })} hint="Minimum 10" /></View>
        </View>
        <TextField label="Pickup instructions" value={settings.pickupInstructions} onChangeText={(pickupInstructions) => setSettings({ ...settings, pickupInstructions })} multiline />
        <Pressable
          style={[styles.saveButton, { opacity: busy || !online ? 0.5 : 1 }]}
          disabled={busy || !online}
          onPress={() => void save({
            deliveryFee: settings.deliveryFee, taxRate: settings.taxRate, serviceChargeRate: settings.serviceChargeRate,
            cardFeeRate: settings.cardFeeRate, minimumOrder: settings.minimumOrder, deliveryMinimumOrder: settings.deliveryMinimumOrder,
            pickupTime: settings.pickupTime, deliveryTime: settings.deliveryTime, pickupInstructions: settings.pickupInstructions,
          })}
        >
          <Text style={styles.saveButtonText}>SAVE CHARGES & TIMING</Text>
        </Pressable>
      </Card>

      <ModalSheet
        visible={pauseOpen}
        title="Pause online ordering?"
        onClose={() => setPauseOpen(false)}
        footer={
          <Pressable
            style={[styles.saveButton, { backgroundColor: dark.danger, opacity: busy ? 0.5 : 1 }]}
            disabled={busy}
            onPress={() => {
              setPauseOpen(false);
              void save({ ordersEnabled: false, orderPauseMessage: pauseMessage });
            }}
          >
            <Text style={[styles.saveButtonText, { color: '#fff' }]}>PAUSE ORDERING</Text>
          </Pressable>
        }
      >
        <View>
          <Text style={styles.hint}>Customers see a paused banner with your message. You can resume anytime.</Text>
          <TextField label="Pause message" value={pauseMessage} onChangeText={setPauseMessage} multiline placeholder="We're busy — back soon!" />
        </View>
      </ModalSheet>
    </AdminPage>
  );
}

function TextInput2(props: { value: string; onChangeText: (v: string) => void; placeholder?: string; editable?: boolean }): React.ReactElement {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={dark.textDim}
      editable={props.editable !== false}
      style={{ color: dark.text, fontSize: 15, paddingVertical: 6 }}
    />
  );
}

const styles = StyleSheet.create({
  message: { color: dark.info, fontWeight: '700', marginBottom: 8 },
  hint: { color: dark.textDim, fontSize: 12, marginTop: 6 },
  pauseButton: { borderWidth: 2, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  saveButton: { backgroundColor: dark.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  saveButtonText: { color: dark.accentText, fontWeight: '900', fontSize: 14, letterSpacing: 0.5 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  hoursInputBox: { flex: 1, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, backgroundColor: dark.surfaceAlt },
  closedChip: { borderWidth: 1.5, borderColor: dark.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
