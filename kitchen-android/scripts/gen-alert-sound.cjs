#!/usr/bin/env node
/**
 * Generates the original Vizio Food new-order alert sound:
 * assets/sounds/new-order-alert.wav
 *
 * Design goals (from the kitchen requirements):
 *   - loud, long, urgent, unmistakably "a new order arrived"
 *   - original — inspired only by the functional need, not copied from any
 *     other product (NOT Uber's sound, NOT a stock Android sound)
 *   - audible across a noisy commercial kitchen
 *
 * Sound design: a rising major triad arpeggio (C6→E6→G6) played twice with
 * hard, bright harmonic content (odd-harmonic "brass" tone), then a short
 * pause and a higher "double ding" (C7 bell partials) as the finisher.
 * Peak-normalized to ~0.95, ~2.4 s total. Mono 16-bit 44.1 kHz WAV.
 *
 * Run:  node scripts/gen-alert-sound.cjs   (from kitchen-android/)
 */

const fs = require('node:fs');
const path = require('node:path');

const SAMPLE_RATE = 44100;
const OUT = path.join(__dirname, '..', 'assets', 'sounds', 'new-order-alert.wav');

// ── Tone synthesis ──────────────────────────────────────────────────────────

/** One note: odd-harmonic bright tone with exponential decay envelope. */
function renderNote(out, startSample, durationSec, freq, peak, decayTau) {
  const length = Math.floor(durationSec * SAMPLE_RATE);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    // Odd harmonics (1, 3, 5, 7) — bright/urgent, cuts through kitchen noise.
    const wave =
      Math.sin(2 * Math.PI * freq * t) * 1.0 +
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.28 +
      Math.sin(2 * Math.PI * freq * 5 * t) * 0.12 +
      Math.sin(2 * Math.PI * freq * 7 * t) * 0.06;
    // Fast attack, exponential decay.
    const attack = Math.min(1, t / 0.008);
    const env = attack * Math.exp(-t / decayTau);
    out[startSample + i] += wave * env * peak;
  }
}

/** Bell-like double ding with inharmonic partials (bell character). */
function renderBell(out, startSample, baseFreq, peak) {
  const partials = [
    { ratio: 1.0, amp: 1.0, tau: 0.45 },
    { ratio: 2.76, amp: 0.4, tau: 0.3 },
    { ratio: 5.4, amp: 0.15, tau: 0.2 },
  ];
  const durationSec = 0.6;
  const length = Math.floor(durationSec * SAMPLE_RATE);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    for (const p of partials) {
      sample += Math.sin(2 * Math.PI * baseFreq * p.ratio * t) * p.amp * Math.exp(-t / p.tau);
    }
    const attack = Math.min(1, t / 0.003);
    out[startSample + i] += sample * attack * peak;
  }
}

function buildScore() {
  const totalSec = 2.4;
  const samples = new Float64Array(Math.floor(totalSec * SAMPLE_RATE));
  const C6 = 1046.5, E6 = 1318.5, G6 = 1568.0, C7 = 2093.0;
  const s = (sec) => Math.floor(sec * SAMPLE_RATE);

  // Motif A: rising triad arpeggio — the "something arrived!" hook.
  // Played twice so a busy cook hears it even if the first pass is missed.
  for (const offset of [0, 0.62]) {
    renderNote(samples, s(offset + 0.00), 0.16, C6, 0.9, 0.10);
    renderNote(samples, s(offset + 0.14), 0.16, E6, 0.95, 0.10);
    renderNote(samples, s(offset + 0.28), 0.28, G6, 1.0, 0.16);
  }

  // Motif B: high bell double-ding — the unmistakable "order" finisher.
  renderBell(samples, s(1.38), C7, 0.85);
  renderBell(samples, s(1.62), C7, 0.95);

  return samples;
}

// ── WAV writing (16-bit PCM mono) ───────────────────────────────────────────

function writeWav(filePath, floatSamples) {
  // Peak-normalize to 0.95 so the alert is as loud as clean PCM allows.
  let peak = 0;
  for (const v of floatSamples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.95 / peak : 1;

  const dataLength = floatSamples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < floatSamples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i] * gain));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

const samples = buildScore();
writeWav(OUT, samples);
const durationSec = (samples.length / SAMPLE_RATE).toFixed(2);
console.log(`Wrote ${OUT} (${durationSec}s, ${SAMPLE_RATE} Hz mono 16-bit, peak-normalized 0.95)`);
