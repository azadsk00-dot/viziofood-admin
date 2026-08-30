import { defineConfig } from 'vite';

// APKs land in the project root when the mobile apps are built, and Windows
// briefly locks them (copy/scan), which crashes the dev-server watcher with
// EBUSY. They never need HMR, so keep them out of the watch tree.
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/*.apk'],
    },
  },
});
