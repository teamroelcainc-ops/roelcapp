# V00450 — REF Cliente duplicada (pestaña Revisión) y comprobante de pago con vista previa

**Solo web.** Sin reglas, índices, banderas ni Cloud Functions nuevas: se publica con el deploy de hosting de siempre.

## 1. REF Cliente duplicada
**Regla (acordada):** una operación está duplicada si OTRA operación tiene la misma Ref Cliente, **de cualquier cliente**.
- Se compara sin mayúsculas/minúsculas ni espacios: `PO 5001` = `po5001`. Los guiones sí cuentan (`PO-1` ≠ `PO1`).
- No cuentan: Ref vacía o de relleno (`N/A`, `NA`, `-`, `S/R`, `S/N`, `N/D`, `0`, `Sin ref`, `No aplica`…), de 1–2 caracteres, operaciones **canceladas** y **de prueba**.
- **No es duplicado**: marca todas las del grupo (`refClienteRevisado` = la Ref en ese momento, con quién y cuándo). Si después cambia la Ref de alguna, se vuelve a revisar. Queda en la bitácora.

| Dónde | Qué pasa |
|---|---|
| **Operaciones Activas** | Pestaña nueva **Revisión** (roja cuando tiene operaciones). La operación duplicada sale de Todos/Transfer/Cruces/Fletes/Rentas/Otros y queda solo en Revisión. Notificación flotante con "Ver en Revisión". |
| **Facturación de Clientes** | Pestaña **Revisión**: las pendientes de facturar con Ref duplicada salen de **Asignar Operaciones** (y de "Agregar referencia a factura") y no se pueden facturar hasta revisarlas. Notificación. Las tarjetas y contadores ya no las cuentan. "Generar Factura" y "Agregar" además se niegan si una seleccionada está en Revisión o su Ref todavía se está verificando ("intenta en unos segundos"). |
| **Formulario de operación** | Al salir del campo Ref Cliente (y al abrir una operación que ya la trae) busca la Ref en todas las operaciones: borde rojo, lista de con cuáles choca y notificación. **No impide guardar.** |
| **Campana** | "REF Cliente duplicada: N operación(es) en Revisión en …" (cuenta para el punto rojo, el brinco y el sonido). Clic → abre la pestaña Revisión. |

En la pestaña Revisión cada operación muestra con qué operaciones choca (consecutivo, cliente, cómo está capturada la Ref allá y su estado: Activa / Completada / Facturada INV-…), con **Ver** (abre la operación) y **No es duplicado**.

### Cómo se busca (lecturas)
Las pantallas tienen cargada solo una parte (Activas trae 50 por página), así que además de comparar la lista se pregunta al servidor: `where('refCliente', 'in', …)` en lotes de 30 valores (la Ref tal cual, recortada, en mayúsculas, en minúsculas, sin espacios, con espacio entre letras y números —`PO 123`—, con un espacio al final y como número si es numérica), 4 consultas a la vez, una vez cada 5 minutos por Ref y por sesión. Se consultan como máximo las **400** operaciones candidatas más recientes por pantalla; las demás se comparan solo contra la lista cargada. Costo: ~1 lectura por Ref consultada (más las duplicadas que encuentre).
- Lo que se guarda en la sesión (formulario, cambiar status, cancelar, eliminar) corrige al momento lo consultado: si se cancela o corrige la otra operación, la que quedaba sale de Revisión sola. **Actualizar** / **Refrescar** vuelven a consultar todo.
- Las que están en Revisión se vuelven a consultar cada 5 minutos (si otra persona corrigió o marcó la otra operación, salen solas).
- **Límite conocido**: el servidor compara texto exacto. Una Ref escrita de una forma que no está en la lista de variantes (p. ej. `Po123` contra `PO123` en dos operaciones que NO están cargadas) no se detecta. La forma completa es un campo normalizado que escriba el servidor (`refClienteClave`, Cloud Function + puesta al día): se puede hacer después, requiere deploy de functions.

### Al publicar
La primera vez saldrán en Revisión TODAS las duplicadas que ya existen (también las de hace meses contra operaciones viejas). Es esperado: se revisan una vez con **No es duplicado** o corrigiendo la Ref.

## 2. Pagos: comprobante con vista previa
En **Registrar Pago** y **Editar Pago** (estilo "Attachments" de QuickBooks):
- Zona punteada **Agregar comprobante**: clic o arrastrar. PDF o imagen, **máx. 20 MB** (antes no había tope).
- Renglón del archivo: nombre, tamaño, estado (**Se sube al guardar** / **Guardado**), **Ver/Ocultar**, **Reemplazar** y **×** (quita el archivo nuevo).
- **Vista previa en el mismo formulario**: el PDF en un visor, la imagen tal cual, y "Abrir en otra pestaña".
- En Editar, el comprobante guardado se ve de inmediato; elegir otro muestra "Al guardar, este archivo reemplaza a «…»".
- Se sube al guardar, igual que antes (`pagos/{id}/{archivo}`).

## Archivos
- Nuevos: `src/features/operaciones/services/refClienteDuplicado.ts` (+ pruebas), `refClienteDuplicadoServidor.ts`, `hooks/useRefClienteDuplicados.ts`, `components/RevisionRefCliente.tsx/.css`; `src/shared/data/avisos.ts`, `src/shared/components/AvisosFlotantes.tsx/.css`; `src/features/pagos/components/AdjuntoComprobante.tsx/.css`, `services/comprobante.ts` (+ pruebas).
- Cambian: `OperacionesDashboard`, `FacturacionClientesDashboard`, `FormularioOperacion`, `PagosDashboard`, `App.tsx` (campana y notificaciones).
- Campos nuevos en `operaciones` (solo al marcar "No es duplicado"): `refClienteRevisado`, `refClienteRevisadoPor`, `refClienteRevisadoEn`. Entran por la regla general (no son de dinero); no cambian reglas.

## Pruebas
- `npm run verificar`: 27 archivos, 295 pruebas (nuevas: clave y variantes de la Ref, canceladas/prueba, revisada, cruce lista ↔ servidor con folios repetidos, lotes de 30, caché corregida al guardar/cancelar/eliminar, consultas en camino compartidas, "No es duplicado" parcial; tipos y tope del comprobante).
- Revisión independiente del cambio (agente aparte): 13 hallazgos, corregidos antes de entregar (ver code-notes).
- Banco de pruebas en navegador (Firebase simulado): Revisión en Operaciones (3) y Facturación (4), notificaciones, campana, "No es duplicado", aviso en el formulario, comprobante nuevo (PDF → imagen) y comprobante guardado al editar. Sin errores de consola.

## No incluido
- Notificar a OTROS usuarios (cada quien ve las suyas al abrir Operaciones o Facturación). Si se quiere que llegue a todos sin abrir esas pantallas, se hace con una Cloud Function que marque las operaciones al guardarlas (requiere deploy de functions).
- Quitar un comprobante ya guardado (sin reemplazarlo).
