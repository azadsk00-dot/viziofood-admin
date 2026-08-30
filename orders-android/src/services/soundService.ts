// SoundService — the in-app alert sound player.
//
// The new-order ALERT sound is a property of the notification channel
// (orders_v2 — see notificationService): one mechanism covers every app
// state. This player serves ONLY the Settings "TEST SOUND" button so staff
// can verify audibility without waiting for an order.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;
let modeConfigured = false;

async function ensureAudioMode(): Promise<void> {
  if (modeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
    modeConfigured = true;
  } catch {
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      modeConfigured = true;
    } catch {
      // Audio may still work; never let setup crash anything.
    }
  }
}

function ensurePlayer(): AudioPlayer | null {
  if (!player) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const source = require('../../assets/sounds/new_order_alert.wav');
      player = createAudioPlayer(source);
    } catch {
      return null;
    }
  }
  return player;
}

/**
 * TEST ALERT SOUND — plays the exact sound a new-order notification plays.
 * seekTo is awaited before play (the v1 player raced them, which could leave
 * the playhead mid-file or swallow the sound entirely).
 */
export async function testAlertSound(): Promise<void> {
  try {
    await ensureAudioMode();
  } catch {
    /* ignore */
  }
  const p = ensurePlayer();
  if (!p) return;
  try {
    p.volume = 1;
    await p.seekTo(0);
    p.play();
  } catch {
    // Never let audio crash anything.
  }
}
