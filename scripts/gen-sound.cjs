// One-off generator: writes a short two-tone "new order" chime as a 16-bit PCM WAV.
// Run once; safe to delete afterwards. No external dependencies.
const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const durationSec = 0.45;
const totalSamples = Math.floor(sampleRate * durationSec);
const bytesPerSample = 2;
const numChannels = 1;
const dataSize = totalSamples * numChannels * bytesPerSample;

const buffer = Buffer.alloc(44 + dataSize);
// RIFF header
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
// fmt subchunk
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);            // PCM chunk size
buffer.writeUInt16LE(1, 20);             // audio format = PCM
buffer.writeUInt16LE(numChannels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
buffer.writeUInt16LE(numChannels * bytesPerSample, 32);              // block align
buffer.writeUInt16LE(8 * bytesPerSample, 34);                        // bits per sample
// data subchunk
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

// Two-tone chime: 880Hz for first 0.14s, then 1175Hz, with attack + exp decay.
const splitSample = Math.floor(sampleRate * 0.14);
const attackSec = 0.01;
const peak = 0.5;
for (let i = 0; i < totalSamples; i++) {
  const t = i / sampleRate;
  const freq = i < splitSample ? 880 : 1175;
  const attack = Math.min(1, t / attackSec);
  const decay = Math.exp(-t / 0.25);
  const sample = Math.sin(2 * Math.PI * freq * t) * attack * decay * peak;
  // 16-bit signed PCM
  buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2);
}

const outDir = path.join(__dirname, '..', 'public', 'sounds');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'new-order.wav');
fs.writeFileSync(outFile, buffer);
console.log('Wrote', outFile, `(${buffer.length} bytes)`);
