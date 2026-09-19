import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// ✅ Capa responsive global: corrige la vista móvil de toda la app (ver el
//    encabezado de mobile.css). Va DESPUÉS de index.css para poder ganar.
import './styles/mobile.css'
import App from './App.tsx'
// ✅ TanStack Query: caché de datos de servidor compartido por toda la app.
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'

// ✅ V00284: cuando el service worker nuevo toma control a mitad de sesión,
//   la página quedaba MEZCLADA (HTML viejo + assets nuevos) y los módulos se
//   veían desordenados hasta recargar a mano. Ahora la app se recarga SOLA
//   (una única vez) en cuanto la versión nueva toma el control.
if ('serviceWorker' in navigator) {
  let yaRecargado = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (yaRecargado) return;
    yaRecargado = true;
    window.location.reload();
  });
}

// ✅ V00316: AUTO-REPARACIÓN de módulos "desordenados" — cada módulo carga
//   bajo demanda (chunk JS + su CSS con hash). Si se publicó una versión
//   mientras la app estaba abierta, al ENTRAR a un módulo la pestaña vieja
//   pide chunks que ya no existen: si falla el CSS, el módulo se pinta solo
//   con estilos globales y se ve DESORDENADO. Vite avisa con
//   vite:preloadError → se recarga UNA sola vez para tomar la versión
//   completa (candado anti-bucle en sessionStorage, que se libera a los 15 s
//   de una carga sana para poder auto-repararse en publicaciones futuras).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault(); // el error se resuelve recargando; no ensucia consola
  try {
    if (sessionStorage.getItem('roelca_recarga_por_chunk') === '1') return;
    sessionStorage.setItem('roelca_recarga_por_chunk', '1');
  } catch { /* almacenamiento bloqueado: recargar de todos modos */ }
  window.location.reload();
});
try { setTimeout(() => sessionStorage.removeItem('roelca_recarga_por_chunk'), 15000); } catch { /* noop */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
