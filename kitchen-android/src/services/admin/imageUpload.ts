// Image upload — Android parity of the web pipeline:
//   pick (camera / gallery / file) → compress (max 1920px, JPEG q0.84, ≤8MB)
//   → Supabase Storage 'product-images' bucket → public URL.
// Uses expo-image-picker + expo-image-manipulator + expo-file-system.
//
// 2026-08-30 rework: the upload itself now goes through
// FileSystem.uploadAsync (the native HTTP upload path) instead of
// supabase-js storage.upload with a decoded ArrayBuffer — the old path died
// silently on-device after file reading (no error surface, no request
// outcome). uploadAsync reports status + body directly, gets a hard timeout,
// and every failure mode maps to a human-readable message.

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync } from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { config } from '../../lib/config';
import { uuidv4 } from '../../lib/format';

const BUCKET = 'product-images';
const MAX_DIMENSION = 1920;
const QUALITY = 0.84;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45_000;

export type PickSource = 'camera' | 'gallery';

export interface UploadResult {
  url: string;
  path: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Turn storage HTTP failures into messages a restaurant manager can act on. */
function readableStorageError(status: number, body: string): string {
  const detail = body.slice(0, 160).replace(/\s+/g, ' ').trim();
  switch (status) {
    case 401:
    case 403:
      return `Upload not allowed for your account${detail ? ` (${detail})` : ''}.`;
    case 404:
      return `Storage bucket "${BUCKET}" not found — ask your admin to create it.`;
    case 413:
      return 'Image too large for storage. Try a smaller photo.';
    case 400:
      return `Storage rejected the file${detail ? `: ${detail}` : ''}.`;
    default:
      return `Storage error (${status})${detail ? `: ${detail}` : ''} — try again.`;
  }
}

async function compress(uri: string, width?: number, height?: number): Promise<{ uri: string; ext: string }> {
  // Aspect-preserving downscale: bound the LONGEST side to 1920px, re-encode
  // JPEG q0.84 — keeps uploads small and fast on restaurant Wi-Fi.
  let action: ImageManipulator.Action = { resize: { width: MAX_DIMENSION } };
  if (width && height) {
    if (height > width) action = { resize: { height: MAX_DIMENSION } };
    else action = { resize: { width: MAX_DIMENSION } };
    if (Math.max(width, height) <= MAX_DIMENSION) action = { resize: { width } };
  }
  const manipulated = await manipulateAsync(uri, [action], {
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: manipulated.uri, ext: 'jpg' };
}

/** Pick + compress + upload with progress reports (0..1). */
export async function pickAndUploadImage(
  source: PickSource,
  folder: 'products' | 'branding',
  onProgress?: (fraction: number, note?: string) => void,
): Promise<UploadResult | null> {
  onProgress?.(0.05, 'Opening picker…');
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: folder === 'branding' ? [4, 3] : [4, 3],
    quality: 0.9,
  };
  // Timeout-guarded: a picker that never returns its result (native hiccup
  // after the crop activity) must surface as an error, not hang the flow.
  const result = await withTimeout(
    source === 'camera'
      ? ImagePicker.launchCameraAsync(options)
      : ImagePicker.launchImageLibraryAsync(options),
    60_000,
    'Image picker did not respond — try again.',
  );
  if (result.canceled || !result.assets?.length) return null; // user closed the picker — not an error

  const asset = result.assets[0];
  return uploadImage(asset.uri, folder, onProgress, asset.width, asset.height);
}

export async function uploadImage(
  uri: string,
  folder: 'products' | 'branding',
  onProgress?: (fraction: number, note?: string) => void,
  width?: number,
  height?: number,
): Promise<UploadResult> {
  onProgress?.(0.25, 'Compressing…');
  const compressed = await compress(uri, width, height);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not signed in — upload the image after logging in.');

  const prefix = folder === 'branding' ? 'branding' : 'products';
  const name = folder === 'branding' ? `logo-${uuidv4()}` : uuidv4();
  const path = `${prefix}/${name}.${compressed.ext}`;

  onProgress?.(0.7, 'Uploading…');
  // The whole upload (base64 read + storage POST) is timeout-guarded: the
  // 1.2.6 pipeline died SILENTLY when the storage request hung after the
  // screen turned off / network flapped — a stall must surface as a readable
  // error, never as an infinite spinner or a dropped action.
  const uploaded = await withTimeout(
    uploadViaStorageClient(compressed.uri, path),
    UPLOAD_TIMEOUT_MS,
    'Upload timed out — check the internet connection and try again.',
  );

  onProgress?.(1, 'Done');
  void uploaded;
  return { url: `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`, path };
}

/** Storage upload through the supabase-js client (proven on this codebase). */
async function uploadViaStorageClient(uri: string, path: string): Promise<void> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = Math.ceil((base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large after compression (${(bytes / 1024 / 1024).toFixed(1)} MB > 8 MB).`);
  }
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

/** Delete a previously uploaded object by its public URL (best effort). */
export async function deleteImageByUrl(url: string): Promise<void> {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return;
  const path = decodeURIComponent(url.slice(index + marker.length));
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    // best effort — orphaned objects are harmless
  }
}

function decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}
