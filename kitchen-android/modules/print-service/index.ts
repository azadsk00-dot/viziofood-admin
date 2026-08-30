// Local Expo module: Android foreground service that keeps the print engine
// (realtime print_jobs + direct TCP printing) alive while the tablet screen
// is off or the app is minimized. Shows the required persistent notification
// on a silent low-importance channel.

import { requireNativeModule } from 'expo';

interface PrintServiceModule {
  start(): void;
  stop(): void;
}

const PrintService = requireNativeModule<PrintServiceModule>('PrintService');

export function startPrintService(): void {
  PrintService.start();
}

export function stopPrintService(): void {
  PrintService.stop();
}
