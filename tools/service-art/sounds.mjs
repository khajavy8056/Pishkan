#!/usr/bin/env node
/**
 * The app's interaction sounds, synthesised here so they are reproducible,
 * royalty-free and tiny (mono 22.05 kHz 16-bit PCM, ~0.25-0.45 s, < 20 KB each).
 *
 * Design rules:
 *  - soft attack (>= 8 ms) and a long release, so nothing clicks or startles;
 *  - success is a rising two-note marimba-ish tone (C5 -> G5) with a light
 *    harmonic; error is a falling minor second (A4 -> F4) with a darker decay;
 *  - taps are a single short blip; nothing loops and nothing exceeds -6 dBFS.
 *
 * Output: apps/mobile/android/app/src/main/res/raw/*.wav
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/mobile/android/app/src/main/res/raw');
fs.mkdirSync(outDir, { recursive: true });
const RATE = 22050;

function synth({ notes, duration, decay = 9, gain = 0.55, harmonics = [1, 0.28, 0.1], attack = 0.01 }) {
  const total = Math.floor(RATE * duration);
  const samples = new Float32Array(total);
  for (const note of notes) {
    const start = Math.floor(RATE * note.at);
    const length = Math.min(total - start, Math.floor(RATE * note.length));
    for (let i = 0; i < length; i += 1) {
      const t = i / RATE;
      const env = Math.min(1, t / attack) * Math.exp(-decay * t);
      let value = 0;
      harmonics.forEach((amp, index) => {
        value += amp * Math.sin(2 * Math.PI * note.freq * (index + 1) * t);
      });
      samples[start + i] += value * env * (note.gain ?? 1);
    }
  }
  // Normalise to -6 dBFS and de-click the tail.
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const scale = peak === 0 ? 0 : (0.5 / peak);
  const buffer = Buffer.alloc(44 + total * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + total * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(RATE, 24); buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i += 1) {
    const fade = Math.min(1, (total - i) / (RATE * 0.02));
    buffer.writeInt16LE(Math.round(samples[i] * scale * gain * fade * 32767), 44 + i * 2);
  }
  return buffer;
}

const sounds = {
  // Saved / submitted: a bright rising fifth.
  action_success: synth({ notes: [
    { at: 0, length: 0.34, freq: 523.25 },
    { at: 0.085, length: 0.36, freq: 783.99, gain: 0.85 },
  ], duration: 0.48, decay: 8 }),
  // Failure: a short falling second, softer so it never feels like a buzzer.
  action_error: synth({ notes: [
    { at: 0, length: 0.3, freq: 440, gain: 0.9 },
    { at: 0.07, length: 0.32, freq: 349.23, gain: 0.85 },
  ], duration: 0.40, decay: 11, gain: 0.4, harmonics: [1, 0.18, 0.06] }),
  // Light UI tick for selection and toggles.
  ui_tap: synth({ notes: [{ at: 0, length: 0.09, freq: 880 }], duration: 0.11, decay: 30, gain: 0.22, harmonics: [1, 0.12] }),
  // Notification tones (one per channel, so they stay distinguishable).
  notice_soft: synth({ notes: [{ at: 0, length: 0.42, freq: 659.25 }, { at: 0.1, length: 0.4, freq: 880, gain: 0.7 }], duration: 0.5, decay: 7, gain: 0.45 }),
  message_soft: synth({ notes: [{ at: 0, length: 0.3, freq: 587.33 }, { at: 0.06, length: 0.34, freq: 739.99, gain: 0.75 }], duration: 0.44, decay: 9, gain: 0.45 }),
  invoice_soft: synth({ notes: [{ at: 0, length: 0.36, freq: 523.25 }, { at: 0.08, length: 0.4, freq: 659.25, gain: 0.8 }], duration: 0.5, decay: 8, gain: 0.45 }),
};

for (const [name, buffer] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(outDir, `${name}.wav`), buffer);
  console.log(`${name}.wav  ${(buffer.length / 1024).toFixed(1)} KB`);
}
