// Persisted terminal settings. The ONLY settings in this app are the printer
// configuration and the alert sound switch (the Orders terminal has no other
// configuration by design).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PrinterSettings } from '../types';

interface SettingsState {
  printer: PrinterSettings;
  /** In-app alert sound (the notification channel sound is separate). */
  soundEnabled: boolean;
  savePrinter: (settings: Partial<PrinterSettings>) => void;
  setSoundEnabled: (enabled: boolean) => void;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  autoPrint: false,
  address: '',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      printer: { ...DEFAULT_PRINTER_SETTINGS },
      soundEnabled: true,
      savePrinter: (settings) =>
        set((state) => ({ printer: { ...state.printer, ...settings } })),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
    }),
    {
      name: 'vizio.orders.settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export const getPrinterSettings = (): PrinterSettings => useSettingsStore.getState().printer;
