// Expo config plugin: wire Firebase (FCM) into local Gradle builds when a
// google-services.json exists at the project root.
//
// WHY: background/locked/closed push notifications need FCM credentials in
// the APK. EAS builds inject Expo-managed FCM credentials automatically (the
// existing VIZIO FOOD project setup); local `expo prebuild` + Gradle builds
// do not. Place the project's google-services.json next to this plugin
// (extracted from an EAS-built APK of this same app — see README) and local
// builds get identical push delivery.
//
// Without the file present this plugin is a no-op, so CI/none-FCM builds are
// unaffected.

const fs = require('node:fs');
const path = require('node:path');
const {
  withProjectBuildGradle,
  withAppBuildGradle,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');

const GOOGLE_SERVICES_JSON = path.join(__dirname, '..', 'google-services.json');
const CLASSPATH = "classpath('com.google.gms:google-services:4.4.2')";
const PLUGIN = "apply plugin: 'com.google.gms.google-services'";

function hasGoogleServices() {
  return fs.existsSync(GOOGLE_SERVICES_JSON);
}

const withGoogleServices = (config) => {
  if (!hasGoogleServices()) {
    console.log(
      '[withGoogleServices] no google-services.json at project root — FCM (background push) will not be wired into this local build.',
    );
    return config;
  }

  // 1. Copy google-services.json into android/app/.
  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const dest = path.join(projectRoot, 'android', 'app', 'google-services.json');
      fs.copyFileSync(GOOGLE_SERVICES_JSON, dest);
      return cfg;
    },
  ]);

  // 2. Add the classpath to the root build.gradle.
  config = withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms:google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        (match) => `${match}\n        ${CLASSPATH}`,
      );
    }
    return cfg;
  });

  // 3. Apply the plugin in app/build.gradle (after the android block setup —
  //    the standard placement is at the top level, after apply plugin lines).
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('com.google.gms.google-services')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /^apply plugin: ["']com\.android\.application["']/m,
        (match) => `${match}\n${PLUGIN}`,
      );
    }
    return cfg;
  });

  return config;
};

module.exports = withGoogleServices;
