import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the same build works from the web host and from inside the Android APK.
export default defineConfig({ plugins: [react()], base: './' });
