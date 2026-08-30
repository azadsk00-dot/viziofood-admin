// Stable device identity — generated once, persisted forever (until app
// data is cleared). Used for kitchen_devices registration, heartbeat,
// notification audit logs and duplicate-alert protection.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { uuidv4 } from './format';

const DEVICE_ID_KEY = 'vizio.device-id';
const DEVICE_NAME_KEY = 'vizio.device-name';

let cachedId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedId) return cachedId;
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    cachedId = existing;
    return existing;
  }
  const id = uuidv4();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  cachedId = id;
  return id;
}

export async function getDeviceName(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_NAME_KEY);
  if (existing) return existing;
  const model = Device.modelName ?? Device.deviceName ?? 'Android Tablet';
  const name = `Kitchen — ${model}`;
  await AsyncStorage.setItem(DEVICE_NAME_KEY, name);
  return name;
}

export async function setDeviceName(name: string): Promise<void> {
  await AsyncStorage.setItem(DEVICE_NAME_KEY, name);
}

export function appVersion(): string {
  return Application.nativeApplicationVersion ?? Application.nativeBuildVersion ?? 'unknown';
}
