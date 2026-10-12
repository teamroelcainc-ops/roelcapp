# V00449 — Animación de espera al filtrar y "Varios" en MTTO

**Solo web. Sin banderas ni pasos en el servidor.** Dos pedidos antes de publicar.

## 1. Animación de espera (nada en blanco al filtrar)
Componente compartido `src/shared/components/CargandoDatos.tsx` (+ `.css`): círculo que gira, texto y barras
animadas. Variantes: `compacto` (sin barras, para tarjetas y modales) y `enLinea` (solo el círculo, para el número
de una tarjeta). Se usa en 35 pantallas.

Además de cambiar los textos sueltos ("Cargando…") por la animación, se corrigieron los **huecos**: momentos en que,
con una petición en curso, la pantalla ya mostraba el estado vacío ("No hay…", "Sin resultados", tarjetas en 0) o nada.

| Causa | Dónde | Corrección |
|---|---|---|
| La bandera de carga se encendía después de `await obtenerFlags()` (hasta 3 s en pestaña nueva) | Servicios Completados, Servicios Cancelados, Resumen del día | Se enciende en el mismo clic de Buscar / al cambiar la fecha; `finally` la apaga en todos los caminos |
| La encendía un efecto un pintado después del clic | Diésel (unidad), Nómina (Ver ficha), Panel de control (año), Usuarios (historial), Facturación (Facturadas/Todas) | Se enciende en el mismo handler |
| Listeners sin "primera respuesta recibida" | Pagos (y al cambiar de pestaña mostraba los pagos de la anterior), Puentes, Diésel, Saldos de puentes, Autorizaciones, Logs, Papelera, Catálogos, Tarifarios, Mis Operaciones, Historial de chequeos, Nómina (`listo` en `useNominasPaginadas`) | Bandera nueva, que también se suelta en el callback de error (no gira para siempre si falla) |
| Bandera que nadie encendía | Estadísticas (`cargandoJoin`; las columnas de facturación salían vacías) | Se enciende al pedir el cruce; nueva `cargandoJoinProv` |
| Estado inicial en `false` aunque la carga empieza al montar | Facturación (facturas), Costos adicionales (modal) | Arranca en `true` |
| Tarjetas en 0 mientras carga | Completados, Facturación, Saldos de puentes, Costos adicionales | Círculo que gira en lugar del número |

Comprobado en el banco de pruebas (app real con Firebase simulado y red lenta): Completados (Buscar), Facturación
Clientes y Pagos muestran la animación y luego los datos; ningún error en consola. El resto compila y pasa las pruebas.

## 2. MTTO: "Varios" en Unidad y Operador
Pedido de César: insumos que se usan en varias unidades (aceite, anticongelante, desengrasante).
- En Nuevo/Editar gasto (Operación o Refacción), al entrar a Unidad u Operador la lista muestra primero **Varios**.
- Se guarda `unidadId: 'Varios'` y `operadorId`/`operadorNombre: 'Varios'` (constante `MTTO_VARIOS`), igual que
  `'Oficina'` en Gastos de Oficina. La tabla, el detalle y la Relación de Compras ya muestran ese valor tal cual.
- Al editar un gasto guardado con Varios, los campos lo muestran (antes un valor que no era una unidad quedaba vacío).
- Las listas de Unidad y Operador ahora se abren al entrar al campo y se cierran al salir de él (antes se quedaban
  abiertas hasta elegir algo).

## Pruebas
`npm run verificar` (tsc, trinquetes de ESLint, consultas y CSS, 267 pruebas), `npm run build`, y el banco de pruebas
en navegador (capturas de Completados, Facturación, Pagos y el formulario de MTTO con Varios).

## Pasos manuales
Ninguno en el servidor. Se aplica con el bundle encima de la V00448 (paso 1 del paso a paso) y se publica con el push.
