import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],

  resolve: {
    alias: {
      // Cardano Serialization Lib - use browser version
      '@emurgo/cardano-serialization-lib-nodejs': '@emurgo/cardano-serialization-lib-browser',
      
      // Stream polyfill
      stream: 'readable-stream',
      
      // Use ES modules version of lodash
      lodash: 'lodash-es',
      
      // Fix libsodium-wrappers-sumo ESM resolution issue
      'libsodium-wrappers-sumo': path.resolve(__dirname, 'node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'),
      'libsodium-wrappers': path.resolve(__dirname, 'node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'),
    },
  },

  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: {
        bigint: true,
      },
    },
    include: [
      'buffer',
      'process',
      'util',
      'events',
      'readable-stream',
      'bip39',
      'bech32',
      'pbkdf2',
      'blake2b',
      '@emurgo/cardano-serialization-lib-browser',
      'lodash-es',
      '@harmoniclabs/uplc',
      '@harmoniclabs/plutus-data',
      '@harmoniclabs/cbor',
      '@harmoniclabs/uint8array-utils',
      'serialize-error',
      'fraction.js',
    ],
    exclude: [],
  },

  define: {
    'process.env': {},
  },

  build: {
    target: 'esnext',
    rollupOptions: {
      external: [],
      output: {
        manualChunks: {
          'cardano-vendor': [
            '@emurgo/cardano-serialization-lib-browser',
          ],
          'crypto-vendor': [
            'bip39',
            'pbkdf2',
            'blake2b',
          ],
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
      requireReturnsDefault: 'auto',
      esmExternals: true,
    },
  },

  ssr: {
    noExternal: ['serialize-error'],
  },

  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})