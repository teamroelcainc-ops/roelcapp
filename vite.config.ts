import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

// ✅ V00534: chunks de librerías pesadas que solo se usan al presionar un botón (los nombra Rollup por
//   su archivo de entrada: html2pdf → manualChunks "pdf", pdfjs-dist → pdf.mjs, exceljs.min, xlsx, jszip.min).
const LIBRERIAS_AL_USAR = ['**/assets/pdf-*.js', '**/assets/pdf.worker*', '**/assets/exceljs.min-*.js', '**/assets/xlsx-*.js', '**/assets/jszip.min-*.js'];
const URL_LIBRERIA_AL_USAR = /\/assets\/(pdf|pdf\.worker\.min|exceljs\.min|xlsx|jszip\.min)-[\w-]+\.m?js$/;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // ✅ V00436 (Fase 0): `npm run dev:medir` (modo "medir") cambia firebase/firestore
  //   por el medidor de lecturas (src/shared/data/medidor). Solo en ese modo.
  resolve: mode === 'medir'
    ? {
        alias: [
          {
            find: /^firebase\/firestore$/,
            replacement: fileURLToPath(new URL('./src/shared/data/medidor/firestoreMedido.ts', import.meta.url)),
          },
        ],
      }
    : undefined,
  build: {
    // ✅ Vendors en chunks separados: react/firebase casi nunca cambian entre
    //    deploys, así que el navegador (y el service worker) los conserva en
    //    caché y solo descarga el código de la app que sí cambió.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          // ✅ V00534: sin firebase/storage — se carga al subir o borrar un archivo (cargarStorage).
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth'],
          // ✅ Fluidez: vendors pesados fuera del bundle principal (mejor
          //   caché entre versiones y carga inicial más ligera).
          pdf: ['html2pdf.js'],
          iconos: ['lucide-react'],
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
        // ✅ V00534: las librerías que solo se usan al presionar un botón (generar PDF, exportar o leer
        //   Excel, armar un .zip, leer un PDF) NO van al precache (~2.8 MB): se bajan la primera vez que
        //   se usan y desde ahí las sirve la caché de abajo (CacheFirst). Por eso generar un PDF o un
        //   Excel SIN CONEXIÓN requiere haberlo hecho antes una vez con conexión en ese navegador.
        globIgnores: LIBRERIAS_AL_USAR,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // ✅ V00534: html2pdf, pdf.js (y su worker), ExcelJS, xlsx y jszip, al usarse. El nombre lleva
            //   hash: un archivo nunca cambia, así que se sirve de la caché sin preguntar a la red.
            urlPattern: URL_LIBRERIA_AL_USAR, // RegExp (una función perdería las variables al copiarse al sw.js)
            handler: 'CacheFirst',
            options: { cacheName: 'librerias-al-usar', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
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
}))
