// src/lib/queryClient.ts
// Cliente global de TanStack Query. Los datos de servidor viven aquí (no en
// useState locales): caché compartido entre vistas, deduplicación de
// peticiones y revalidación controlada.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Un dato se considera fresco 5 min: volver a un módulo NO re-descarga.
      staleTime: 5 * 60 * 1000,
      // Se conserva en memoria 30 min aunque nadie lo esté mostrando.
      gcTime: 30 * 60 * 1000,
      retry: 1,
      // El caché persistente de Firestore ya sincroniza; evitamos refetches
      // sorpresivos al cambiar de pestaña.
      refetchOnWindowFocus: false,
    },
  },
});
