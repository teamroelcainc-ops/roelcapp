# V00428 — Tarifario, Convenios y Operaciones dicen lo mismo

## Causas encontradas
1. **Operaciones solo leía convenios por su convenio maestro.** El modal "Convenios del Cliente" ofrecía un
   detalle solo si su `convenioId` apuntaba a un convenio maestro VIVO del cliente. Si el maestro se unió o
   se borró (o el tarifario apunta a uno que ya no existe), la línea seguía en el Tarifario pero no salía
   en Operaciones ni con su cliente en Convenio de Clientes (caso Trompo de C.H. Robinson).
2. **"Sincronizar convenios" comparaba los números como texto.** Desde V00346 conviven "CONV-173" y "173".
   La limpieza de huérfanos (FASE 3) no reconocía al detalle "173" como usado por la línea "CONV-173" y, si
   había otro convenio con el MISMO nombre (dos Trompo de Exportación a $50 y $100), lo BORRABA → la línea
   quedaba "Sin convenio".
3. **La reparación de duplicados (FASE 1) aceptaba coincidencia solo por nombre**, aunque el monto fuera
   distinto: podía fusionar dos tarifas diferentes del mismo servicio y borrar una.
4. Operaciones también trae convenios del cliente que NO están en el tarifario (p. ej. 186 y 187) porque se
   dieron de alta directo en Convenio de Clientes.

## Cambios
- **FormularioOperacion** (modal de convenios del cliente): además de los convenios del maestro del cliente,
  entran los que referencia cualquier línea de un tarifario del cliente (por NÚMERO: CONV-173 = 173) y los
  que tienen `tarifarioId` de un tarifario del cliente. El status de la línea manda. # Tarifario resuelto por
  número. Lista ordenada por # de convenio.
- **Tarifario Clientes → ⟳ Sincronizar convenios** (y la sincronización global):
  - Si el tarifario apunta a un convenio maestro borrado/de otra empresa, se liga al maestro vivo del
    cliente (o se crea uno).
  - FASE A: los detalles de sus líneas que viven fuera de los convenios del cliente se REAPUNTAN al
    convenio del cliente. Si el # pertenece a OTRA empresa no se toca y se reporta.
  - "usados" por número; FASE 1 exige mismo monto; ningún convenio con operaciones se borra.
  - FASE 0 vuelve a crear los "Sin convenio" con SU MISMO número (nunca pisa el de otra empresa).
  - FASE B: status del detalle = status de la línea.
  - FASE 4: los convenios del cliente que no están en ningún tarifario se AGREGAN como línea con su mismo #.
- **Detalle del tarifario**: chip "⚠ Desligado" (con el motivo al pasar el mouse) en las líneas que no salían
  en Operaciones, y botón "⚠ N convenio(s) fuera del tarifario" que sincroniza.

## Qué hacer después de publicar
1. Abrir TARI-041 (C.H. Robinson) → **⟳ Sincronizar convenios** y leer el resumen.
2. Si quedó bien, correr la **sincronización global** para todos los tarifarios.
3. Revisar CONV-173 (Cruce de Exportación - Tractor - Trompo - 240 Nuevo Laredo, $50): es la misma tarifa
   que CONV-180 ($100). Al sincronizar se vuelve a crear; si no debe existir, eliminar la línea con 🗑.

## Archivos
src/features/operaciones/components/FormularioOperacion.tsx
src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx
src/features/tarifarioClientes/components/TarifarioClientesDashboard.css
src/config/version.ts, public/version.json, src/config/historialCambios.ts

Verificación: tsc 0; eslint igual que antes (Formulario 376, Tarifario 0); build OK.
