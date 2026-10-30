# V00529 — Facturación de Clientes: "Actualizar factura" muestra lo que quedó en el servidor · más rápido

**Solo web.** Va encima de la V00528. Sin funciones, reglas, índices, banderas ni dependencias.

## El reporte (I8650)
- El botón tardaba y luego decía **"La factura ya estaba al día"**.
- La Ficha seguía en "$100.00 → hoy $50.00" y en la tabla no se veía ningún cambio.

## Qué pasaba
1. La transacción relee la factura y sus operaciones **en el servidor**.
   - Ahí no encontró nada que cambiar, así que no escribió nada (eso estuvo bien).
   - Pero la pantalla se quedó con la copia vieja: el aviso y el "→ hoy" seguían, como si no hubiera pasado nada.
2. La copia vieja venía de la pestaña **Corregir**.
   - Corregir es una **foto** de cuando se presionó Revisar.
   - Al hacer clic en una factura de esa lista se abría la factura de la foto, no la de ahora. Si después se puso al día, la Ficha no lo sabía.
3. Hay otra causa posible.
   - El último cambio de la operación (a $50) puede estar todavía solo en esta computadora y no en el servidor.
   - En ese caso la pantalla ve $50 y el servidor $100.
   - Ahora el aviso dice cuál de las dos fue.

## Qué cambia
- **Corregir** abre la factura **como está ahora** (la lista en vivo), no la de la foto.
- Después de **Actualizar factura** (y de Actualizar en Editar factura):
  - la Ficha, la lista y Corregir muestran **lo que quedó en el servidor**;
  - Corregir se recalcula solo, conservando la hora de su revisión.
- Si en el servidor no había nada que cambiar, el aviso dice **por qué, con los números del servidor**, operación por operación. Por ejemplo:
  - "TR-231026-030: en el servidor la factura ya la tenía en $ 50.00";
  - "TR-231026-030: en el servidor la operación cobra $ 100.00 (aquí se veía $ 50.00): su último cambio todavía no está guardado en el servidor".

## Más rápido
En el simulador de la app, el tiempo del botón bajó de ~0.95 s a ~0.7 s:
- **Lectura en paralelo.** La transacción lee la factura y sus operaciones **al mismo tiempo** (una ida y vuelta menos). Sigue siendo una transacción.
- **El botón no repinta todo el módulo.** El "Actualizando…" vive en su propio componente (`ActualizarFacturaFicha`). Al presionarlo ya no se vuelve a pintar todo Facturación de Clientes.
- **Menos recálculos.** Poner al día una factura ya no rehace el índice operación → factura cuando sus operaciones no cambian (`useValorEstable`). Con eso ya no se repiten la revisión de Ref Cliente ni el cotejo de CFDI de todas las operaciones. Era la mitad del tiempo de repintar.
- **Catálogos sin estorbar.** Los catálogos del formulario que se abren en segundo plano (V00528) esperan a que lleves 2 s sin hacer clic ni teclear, para no competir con lo que estás haciendo.

## Archivos (17)
- `src/features/facturacion/components/ActualizarFacturaFicha.tsx` y `.css` (nuevos)
- `src/shared/hooks/useValorEstable.ts` y `useValorEstable.test.tsx` (nuevos)
- `src/features/facturacion/services/sincronizarFactura.ts` y `sincronizarFactura.test.ts`
- `src/features/facturacion/services/actualizarFactura.ts`
- `src/features/facturacion/hooks/useOperacionesDeFactura.ts`
- `src/features/facturacion/components/FacturacionClientesDashboard.tsx` y `.css`
- `src/shared/data/catalogos.ts` y `catalogos.test.tsx`
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `code-notes.md`, `CAMBIOS-V00529.md`

## Pasos manuales
1. Aplica el zip encima de la V00528 (no hay archivos borrados) y haz el commit. El conteo debe dar **17**.
2. Publica la web.
3. Abre la I8650 desde Historial y fíjate qué pasa:
   - **Si ya no sale el aviso:** ya estaba al día en el servidor.
   - **Si sale el aviso:** presiona **Actualizar factura** y mándame captura del aviso que aparece. Dice con números qué hay en el servidor.
