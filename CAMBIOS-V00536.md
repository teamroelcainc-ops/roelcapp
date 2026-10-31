# V00536 — Paso 3 del refactor: cambios al momento con el bus

**Web + una función del servidor.** Va encima de la V00535. Sin reglas, índices, banderas ni dependencias.
**Tipo:** fix (cambia lo que se ve).

**⚠ Servidor:** solo si tienes encendida `dineroPorServidor`, hay que publicar `editarFactura` para que el folio llegue a las operaciones también por ese camino:
```
npm --prefix functions run build
firebase deploy --only functions:editarFactura
```
Con la bandera apagada (lo normal hoy), la web lo hace sola.

**Script sin correr (punto de parada P2):** `functions/scripts/folioEnOperaciones.ts` pone al día el folio de las operaciones que quedaron con el viejo. **No lo corrí.** Primero en simulación y me mandas `cambios.csv` (ver "Pasos manuales").

## Qué se arregló
Todas las listas (Operaciones, Completados, Facturación, Pagos) leen una vez y se conectan con el bus de operaciones. El bus tenía huecos.

| Problema (auditoría) | Ahora |
| --- | --- |
| Completados solo aplicaba las conexiones (factura, nómina…): editar con ✎ desde Facturación no cambiaba montos, convenio ni fechas | Aplica el aviso **completo**. Sale la que deja de estar completada o Falso. Entra una completada dentro de las fechas que buscaste |
| Escrituras que no avisaban | Ahora avisan: costo adicional (Clientes y Proveedores), confirmación de tarifa, "Rectificar" en Pagos, nómina (sueldo, extra, guardar y eliminar), diésel, puentes, Saldos de Puentes, cambio de sueldo, Tablero, Mis Operaciones, Costos adicionales, Editar y Eliminar en Completados, Ref Cliente revisada, las herramientas de Revisión (D3, F1, Corregir desglose), Migración de status, Sincronizar nombres, Propagar moneda, Razón social, Quitar prefijo CONV, Pasar operaciones, renombres de catálogos, convenios y empresas, y "Reparar consecutivos" (antes avisaba sin operación) |
| Respuestas del servidor (`llamarDinero`) | Cada respuesta avisa las operaciones que tocó |
| `aplicarOperaciones` buscaba por `id` | Busca por el id del documento (`_docId`): en las importadas no se veía el cambio |
| "Diferencia en cargos" y "Sincronizar monedas" sacaban la operación de Facturación Clientes (avisaban sin status) | Facturación solo saca o mete una fila cuando el aviso trae el **status**. Proveedores usa la misma regla (antes metía cualquier aviso) |
| El bus borraba dos cachés que ya nadie usa; la de 5 min de Completados y la de Cancelados no se invalidaban | Borra las reales: `roelca_completadas_all_`, `…_rango_`, `…_canon_` y `cancelados_` (no toca filtros, columnas ni exportaciones guardadas) |
| Fichas congeladas al abrirlas | La ficha de una factura (Facturación Clientes y Proveedores, Pagos) y la de una operación (Operaciones) siguen a su lista: un cambio se ve sin cerrarlas |
| El folio editado nunca llegaba a la operación | Editar factura escribe el # de Invoice también en sus operaciones (web y servidor). Solo en las ligadas a esa factura |
| `_docId` perdido en Completados y en el editor embebido | Se conserva. Con eso, Editar y Eliminar en Completados, "Rectificar" en Pagos y la Confirmación de tarifa escriben en el documento real (antes, en las importadas, en el `id` de la lista) |

**Sigue igual:** las listas no escuchan Firestore. Lo que guarda otro usuario, u otra pestaña, llega en el paso 4.

## Archivos (55)
- **Nuevos:**
  - `src/shared/hooks/useFichaViva.ts`;
  - `src/features/facturacion/services/{reglaFacturables,folioEnOperaciones}.ts`;
  - `functions/scripts/folioEnOperaciones.ts`;
  - pruebas: `operacionesBus.test.ts`, `useFichaViva.test.tsx`, `dineroServidor.test.ts`, `folioEnOperaciones.test.ts` y casos nuevos en `facturacion.test.ts`.
- **Cambiados:**
  - `utils/operacionesBus.ts`;
  - las pantallas y servicios de la tabla;
  - `shared/dominio/facturacion.ts` y su copia en `functions/src/dominio`;
  - `functions/src/dinero.ts`;
  - `functions/package.json` (solo el comando `folios`, sin dependencias nuevas).
- **Además:** versión, historial, `code-notes.md`, `refactor-progress.md` y `scripts/lint-baseline.json`.

## Pasos manuales
1. Aplica el zip encima de la V00535 (no hay archivos borrados):
   ```
   git add src functions/src functions/scripts functions/package.json public/version.json scripts/lint-baseline.json CAMBIOS-V00536.md code-notes.md refactor-progress.md
   ```
   El conteo debe dar **55**.
2. Publica la web.
3. Solo con `dineroPorServidor` encendida: el despliegue de `editarFactura` de arriba.
4. **P2 — folios viejos (cuando quieras, no es urgente):**
   - Desde `functions/`, corre `npm run folios`. Es la simulación: no escribe.
   - Mándame el resumen y `reportes/folios-…/cambios.csv`.
   - Con tu autorización por escrito y el respaldo hecho: `npm run folios -- --aplicar --confirmo-respaldo`.

## Qué revisar en el navegador
1. **✎ desde Facturación → Completados:**
   - Abre Servicios Completados y busca un rango.
   - Sin recargar, ve a Facturación Clientes y edita con ✎ una operación de ese rango (por ejemplo, el monto del convenio). Guarda.
   - Vuelve a Completados: la fila ya trae el monto nuevo.
2. **Ficha abierta de Operaciones:**
   - Abre la ficha de una operación en Operaciones Activas.
   - Desde Mis Operaciones o el Tablero, cámbiale el status.
   - Al volver, la ficha y la fila muestran el status nuevo sin cerrarla.
3. **Diferencia en cargos:** en Facturación Clientes, usa "Diferencia en cargos" en una factura. Sus operaciones siguen en la lista con el costo nuevo; ya no desaparecen.
4. **Folio:**
   - En Facturación (Clientes o Proveedores), edita el # de Invoice de una factura y guarda.
   - En Completados (ficha de una de sus operaciones) y en Operaciones aparece el folio nuevo sin recargar, y sigue después de recargar.
5. **Costo adicional / Confirmación de tarifa:** guarda uno en Facturación. Completados lo muestra sin recargar.
6. **Ficha de factura en Pagos:** déjala abierta. Si otro usuario registra un pago a esa factura, el saldo se pone al día sin cerrarla.
7. **Eliminar en Completados:** la operación sale también de la lista de Facturación.

## Mediciones
- **Peso** (`medir-pantallas`): +1 KB gz por pantalla (bus, `useFichaViva`, folio); el login igual; precache 5.09 MB (258).
- **Repintados** (`medir:render`): iguales a la V00535.

## Lo que no pude probar en el navegador real
tsc, ESLint, verificar-consultas y verificar-css pasan. Vitest pasa: 873 pruebas, 26 nuevas. El build de funciones y sus 85 pruebas pasan.

En el simulador probé:
- un aviso cambia la fila y la ficha abierta de Operaciones sin cerrarla;
- en Facturación Clientes, un aviso sin status deja la operación en "en espera por facturar" (6239 → 6239) y uno con status no facturable la saca (→ 6238).

**No probé:**
- Firestore real;
- el servidor desplegado (`editarFactura` con las operaciones);
- el script de folios (no se corre);
- cada una de las ~45 escrituras que ahora avisan. Revísalas con la lista de arriba.
