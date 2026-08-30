// Config plugin: Android network security configuration.
//
// Release policy: NO cleartext through the platform HTTP stack — Supabase,
// Stripe and Edge Functions are all HTTPS. The LAN printer agent is reached
// over a raw TCP socket (src/services/agentHttp.ts), which this policy does
// not govern, so no cleartext exception is granted to any host. This replaces
// the silent default (cleartext blocked since targetSdk 28) with an explicit,
// documented policy.
//
// Debug/debugOptimized variants get a permissive copy so dev builds can load
// from the Metro bundler (plain HTTP) as usual. Android resource merging
// picks the variant-specific file over main for those build types.

import { AndroidConfig, type ConfigPlugin, withAndroidManifest, withDangerousMod } from 'expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';

const RELEASE_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!-- Vizio Kitchen: HTTPS only for all platform HTTP traffic (Supabase, Stripe,
     Edge Functions). The LAN printer agent is contacted over raw TCP sockets
     (src/services/agentHttp.ts), not through this stack, so there are no
     cleartext exceptions for any host or IP. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

const DEBUG_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<!-- Debug builds only: cleartext allowed so the Metro bundler (plain HTTP)
     and local dev servers work. Release builds use the strict main config. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

const withNetworkSecurityConfig: ConfigPlugin<void> = (config) => {
  const withRes = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const projectRoot = modConfig.modRequest.platformProjectRoot;
      const mainDir = path.join(projectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(mainDir, { recursive: true });
      fs.writeFileSync(path.join(mainDir, 'network_security_config.xml'), RELEASE_CONFIG);
      for (const variant of ['debug', 'debugOptimized']) {
        const variantDir = path.join(projectRoot, `app/src/${variant}/res/xml`);
        fs.mkdirSync(variantDir, { recursive: true });
        fs.writeFileSync(path.join(variantDir, 'network_security_config.xml'), DEBUG_CONFIG);
      }
      return modConfig;
    },
  ]);

  return withAndroidManifest(withRes, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return modConfig;
  });
};

export default withNetworkSecurityConfig;
