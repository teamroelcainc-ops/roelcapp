import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  build: {
    // ✅ Vendors en chunks separados: react/firebase casi nunca cambian entre
    //    deploys, así que el navegador (y el service worker) los conserva en
    //    caché y solo descarga el código de la app que sí cambió.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage'],
        },
      },
    },
  },
  plugins: [
    react(),
    // ✅ PWA: la app queda INSTALABLE (Android/iOS/desktop) y el "cascarón"
    //    (JS/CSS/HTML/iconos) se sirve desde el service worker sin red, como
    //    una app de Play Store. Con autoUpdate, al publicar una versión nueva
    //    el SW la descarga en segundo plano y la activa al recargar.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Roelca Inc',
        short_name: 'Roelca',
        description: 'Sistema de operaciones y logística Roelca',
        lang: 'es-MX',
        start_url: '/',
        display: 'standalone',
        background_color: '#0d1117',
        theme_color: '#0d1117',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precachea todo el build (app shell). Los datos NO se cachean aquí:
        // de eso se encarga el caché persistente de Firestore (IndexedDB).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Fuentes/estáticos de terceros: cache-first (no cambian).
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'fuentes', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // Imágenes de Firebase Storage (logos, evidencias): stale-while-revalidate —
            // se pintan al instante desde caché y se refrescan en segundo plano.
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'storage-img', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
})
