#!/usr/bin/env node
/**
 * Wire the release signing config into android/app/build.gradle after each
 * `expo prebuild` (prebuild regenerates android/ and would otherwise leave
 * release builds on the debug keystore).
 *
 * Keystore: vizio-orders.keystore in the project root (gitignored — BACK IT
 * UP; every future update of com.viziofood.orders must be signed with it).
 * Credentials can be overridden via environment variables:
 *
 *   VIZIO_ORDERS_STORE_FILE  (default ../vizio-orders.keystore, relative to android/app)
 *   VIZIO_ORDERS_STORE_PASS
 *   VIZIO_ORDERS_KEY_ALIAS
 *   VIZIO_ORDERS_KEY_PASS
 *
 * Run: node scripts/configure-signing.cjs   (from orders-android/, after prebuild)
 */

const fs = require('node:fs');
const path = require('node:path');

const appGradle = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
const keystore = path.join(__dirname, '..', 'vizio-orders.keystore');

if (!fs.existsSync(appGradle)) {
  console.error('android/app/build.gradle not found — run `npm run prebuild` first.');
  process.exit(1);
}
if (!fs.existsSync(keystore)) {
  console.error(
    'vizio-orders.keystore not found. Generate it once (see README) — the release build falls back to the debug keystore without it.',
  );
  process.exit(1);
}

const storePass = process.env.VIZIO_ORDERS_STORE_PASS ?? 'vizioorders2026';
const keyAlias = process.env.VIZIO_ORDERS_KEY_ALIAS ?? 'vizio-orders';
const keyPass = process.env.VIZIO_ORDERS_KEY_PASS ?? 'vizioorders2026';

let gradle = fs.readFileSync(appGradle, 'utf8');
if (gradle.includes('vizioOrdersReleaseSigning')) {
  console.log('Signing config already present — nothing to do.');
  process.exit(0);
}

const signingBlock = `
    // Release signing for com.viziofood.orders (added by scripts/configure-signing.cjs).
    signingConfigs {
        vizioOrdersReleaseSigning {
            storeFile file('../../vizio-orders.keystore')
            storePassword System.getenv("VIZIO_ORDERS_STORE_PASS") ?: "${storePass}"
            keyAlias System.getenv("VIZIO_ORDERS_KEY_ALIAS") ?: "${keyAlias}"
            keyPassword System.getenv("VIZIO_ORDERS_KEY_PASS") ?: "${keyPass}"
        }
    }
`;

// Insert the signing config right after `android {`.
gradle = gradle.replace(/^android\s*\{/m, (match) => `${match}\n${signingBlock}`);
// Point release builds at it (the template signs release with debug).
gradle = gradle.replace(
  /signingConfig signingConfigs\.debug(\s*\/\/[^\n]*)?/g,
  'signingConfig signingConfigs.vizioOrdersReleaseSigning',
);

fs.writeFileSync(appGradle, gradle);
console.log('Release signing configured (vizio-orders.keystore).');
