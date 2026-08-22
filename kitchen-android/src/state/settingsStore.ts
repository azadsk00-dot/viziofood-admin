// Settings store — persisted to AsyncStorage, normalized on load so a
// corrupted or outdated store can never break the app.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, KitchenSettings, normalizeSettings, normalizeThresholds } from '../lib/settings';

interface SettingsState {
  settings: KitchenSettings;
  update: (patch: Partial<KitchenSettings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) =>
        set((state) => ({
          settings: normalizeThresholds(normalizeSettings({ ...state.settings, ...patch })),
        })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'vizio.kitchen-settings',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => {
        const loaded = (persisted as { settings?: Partial<KitchenSettings> } | undefined)?.settings;
        return {
          ...current,
          settings: normalizeThresholds(normalizeSettings(loaded)),
        };
      },
    },
  ),
);

export const getSettings = (): KitchenSettings => useSettingsStore.getState().settings;
