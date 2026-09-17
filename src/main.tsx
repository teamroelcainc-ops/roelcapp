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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
