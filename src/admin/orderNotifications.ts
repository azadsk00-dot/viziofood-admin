/** Track which order IDs have already been notified this session to prevent duplicates. */
const notified = new Set<string>();

/**
 * HTMLAudioElement used for the new-order chime. Created lazily on first play so
 * the same element can be reused across notifications (warm cache + warm audio
 * decoder, so the second+ plays start almost instantly).
 */
const ORDER_SOUND_URL = '/sounds/new-order.wav';
let orderAudio: HTMLAudioElement | null = null;
/** Whether the user has performed a gesture that lets us actually produce audio. */
let audioUnlocked = false;

/**
 * Browsers block audio from a brand-new AudioContext/Audio element until the user
 * has interacted with the page. The first time we detect a gesture we "unlock"
 * audio by playing the chime silently, after which later plays are audible.
 *
 * This is set up once on module load.
 */
function setupAudioUnlock(): void {
  if (typeof window === 'undefined') return;
  if ((setupAudioUnlock as unknown as { done?: boolean }).done) return;
  (setupAudioUnlock as unknown as { done?: boolean }).done = true;

  const unlock = () => {
    audioUnlocked = true;
    console.log('[vizio-sound] audio unlocked by user gesture');
    // Once unlocked we no longer need the listeners.
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}
setupAudioUnlock();

/**
 * Request browser notification permission (called once on user interaction).
 * Returns true if permission was granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** Show a browser Notification (only if tab is hidden or permission granted). */
function showBrowserNotification(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/favicon.ico', tag: 'vizio-order' });
  } catch { /* Notification constructor may throw in some contexts. */ }
}

/**
 * Plays the new-order chime. Uses a reusable <audio> element (more reliable than
 * a freshly-created AudioContext, which often starts "suspended" when a realtime
 * INSERT arrives with no user gesture). Falls back to the WebAudio chime if the
 * audio file fails to load. Safe to call repeatedly.
 */
export function playNewPaidOrderSound() {
  console.log('[vizio-sound] 🔔 playNewPaidOrderSound called', { audioUnlocked });

  // Primary path: HTMLAudioElement pointing at /sounds/new-order.wav
  try {
    if (!orderAudio) {
      console.log('[vizio-sound] creating <audio> element for', ORDER_SOUND_URL);
      orderAudio = new Audio(ORDER_SOUND_URL);
      orderAudio.preload = 'auto';
      orderAudio.addEventListener('error', () => {
        console.warn('[vizio-sound] <audio> error', orderAudio?.error);
      });
      orderAudio.addEventListener('canplaythrough', () => {
        console.log('[vizio-sound] <audio> ready');
      });
    }

    // Rewind so rapid back-to-back orders each play in full.
    orderAudio.currentTime = 0;
    const playPromise = orderAudio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => console.log('[vizio-sound] ✅ <audio> started playing'))
        .catch((err: unknown) => {
          console.warn('[vizio-sound] ⚠️ <audio>.play() rejected — falling back to WebAudio', err);
          playWebAudioChime();
        });
    } else {
      console.log('[vizio-sound] ✅ <audio> play() (no promise)');
    }
    return;
  } catch (err) {
    console.warn('[vizio-sound] <audio> path threw — falling back to WebAudio', err);
  }

  playWebAudioChime();
}

/** Original WebAudio two-tone chime, used as a fallback if the <audio> file fails. */
function playWebAudioChime() {
  try {
    console.log('[vizio-sound] WebAudio fallback');
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) {
      console.warn('[vizio-sound] no AudioContext available');
      return;
    }
    const context = new AudioContextConstructor();
    if (context.state === 'suspended') {
      void context.resume();
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.setValueAtTime(1175, context.currentTime + 0.14);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.45);
    oscillator.addEventListener('ended', () => void context.close());
  } catch (err) {
    console.warn('[vizio-sound] WebAudio fallback threw', err);
  }
}

/**
 * Full notification pipeline for a new paid order.
 * Deduplicates by order ID — will not fire twice for the same order in one session.
 *
 * @param orderId  UUID of the new order
 * @param payload  Raw `new` row from the Supabase realtime INSERT payload
 * @param toast    Toast `show` function from useToast()
 */
export function notifyNewOrder(
  orderId: string,
  payload: Record<string, unknown>,
  toast: { show: (message: string, options?: 'success' | 'error') => void },
): void {
  console.log('[vizio-sound] 🔔 notifyNewOrder called', { orderId, payload });
  if (notified.has(orderId)) {
    console.log('[vizio-sound] → skipped (already notified)', orderId);
    return;
  }
  notified.add(orderId);
  console.log('[vizio-sound] → marked notified', orderId);

  const orderNumber = String(payload.order_number ?? '');
  const customer = String(payload.customer_name ?? 'Customer');
  const total = Number(payload.total ?? 0);
  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(total);

  // In-app toast with order details
  console.log('[vizio-sound] → showing toast');
  toast.show(`🛎 ${orderNumber || 'New order'} — ${customer} — ${money}`);

  // Audio alert
  console.log('[vizio-sound] → calling playNewPaidOrderSound()');
  playNewPaidOrderSound();

  // Browser notification (useful when admin tab is in background)
  const title = `New order: ${orderNumber}`;
  const body = `${customer} · ${money}`;
  console.log('[vizio-sound] → calling showBrowserNotification()');
  showBrowserNotification(title, body);
}
