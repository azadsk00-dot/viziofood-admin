// Image upload — Android parity of the web pipeline:
//   pick (camera / gallery / file) → compress (max 1920px, JPEG q0.84, ≤8MB)
//   → Supabase Storage 'product-images' bucket → public URL.
// Uses expo-image-picker + expo-image-manipulator + expo-file-system.

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { manipulateAsync } from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import { uuidv4 } from '../../lib/format';

const BUCKET = 'product-images';
const MAX_DIMENSION = 1920;
const QUALITY = 0.84;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type PickSource = 'camera' | 'gallery';

export interface UploadResult {
  url: string;
  path: string;
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
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;

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

  onProgress?.(0.5, 'Reading file…');
  const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = Math.ceil((base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) throw new Error(`Image is too large after compression (${(bytes / 1024 / 1024).toFixed(1)} MB > 8 MB).`);

  onProgress?.(0.7, 'Uploading…');
  const prefix = folder === 'branding' ? 'branding' : 'products';
  const name = folder === 'branding' ? `logo-${uuidv4()}` : uuidv4();
  const path = `${prefix}/${name}.${compressed.ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  onProgress?.(1, 'Done');
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
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
