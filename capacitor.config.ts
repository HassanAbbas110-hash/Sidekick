import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sidekick.organiser',
  appName: 'Sidekick',
  webDir: 'dist',
  plugins: {
    // Show the system notification even while Sidekick is open, not only when it is in the background.
    PushNotifications: { presentationOptions: ['alert', 'sound', 'badge'] },
  },
};

export default config;
