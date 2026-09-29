# V00389 — Tres tarjetas de puente · proveedor por nombre corto

## 1. Proveedor de Transporte
- El buscador muestra el NOMBRE CORTO (en grande) con la razón social debajo; también busca por
  razón social. Al elegirlo, en el campo queda la RAZÓN SOCIAL (lo que se guarda y se muestra en
  operaciones, facturación y pagos).

## 2. Resumen del día (Operaciones Activas)
- Se quitó la tarjeta "Canceladas hoy".
- La tarjeta "Casetas del día" se reemplazó por TRES tarjetas:
  - Puente AVI (Caseta AVI y variantes AVI / Trompo AVI)
  - Puente III (Caseta Puente III, Trompo Puente III y casetas Mx hacia Nuevo Laredo)
  - Puente Colombia: dos bloques — Caseta (Caseta Mx Colombia / Trompo Colombia) y Puente
    (Puente Mx Colombia).
- Cada bloque: gastado hoy con número de cruces (clic = lista de cruces del día) y saldo disponible
  (en rojo si está sobregirado). "+ Actualizar saldo" solo ofrece los puentes de esa tarjeta.

## 3. Puente Colombia
- Caseta y puente se cobran por separado (V00388) y aquí se ven por separado.

## Archivos
src/App.tsx
src/features/operaciones/components/{TarjetaCasetas.tsx, TarjetaCasetas.css, FormularioOperacion.tsx, FormularioOperacion.css}
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (App 72, Formulario 376, TarjetaCasetas 0); build OK.
