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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
