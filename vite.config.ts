import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      // Offscreen audio document isn't referenced from the manifest, so crxjs
      // wouldn't pick it up automatically. Register it as an explicit entry
      // so Vite bundles it and chrome.offscreen.createDocument can find it.
      input: {
        'offscreen-audio': 'src/background/offscreen-audio.html',
      },
    },
  },
});
