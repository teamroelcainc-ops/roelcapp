# V00281 — # Tarifario al instante, moneda de cotización y direcciones sin "undefined"

## Archivos que cambian (respetar rutas)
- `src/features/operaciones/components/FormularioOperacion.tsx` y `.css`
- `src/features/operaciones/components/OperacionesDashboard.tsx`
- `src/features/operaciones/components/ServiciosCompletados.tsx`
- `src/features/operaciones/components/ServiciosCancelados.tsx`
- `src/utils/direccionEmpresa.ts` — NUEVO (helper relacional de direcciones)
- `src/config/version.ts` y `public/version.json` — bump a V00281.

## 1) El # de Tarifario aparece de inmediato (y la fila sigue cliqueable)
Dos causas atacadas:
- **Relación más directa:** cada tarifario guarda sus tarifas con el
  consecutivo CONV-### que les asignó al crearse. Ahora esa es la fuente
  principal (después del tarifarioId directo): CONV-### → tarifas[] del
  tarifario → TARI-###. Con eso los convenios de Landstar (y cualquier
  otro migrado) resuelven su tarifario aunque no tengan tarifarioId ni
  convenioId ligado.
- **Carga con respaldo:** si el caché de catálogos llegó sin tarifarios,
  el formulario los descarga directo al abrir — el número ya no espera.
El clic en cualquier parte de la fila (incluidas las columnas #) sigue
seleccionando el convenio.

## 2) Columna "Cotizado en" en el modal
Entre Tarifa y Monto, cada convenio muestra su moneda de cotización como
chip (USD verde / MXN azul) — la del DETALLE, que es la que manda
(regla V00126). Cliente y proveedor.

## 3) Direcciones sin "undefined" en los documentos
La causa: los generadores de Instrucciones del Servicio, Check List,
Solicitud, Prueba de Entrega y Carta usaban el campo de TEXTO plano
`empresa.direccion` — las empresas relacionales solo traen `direccionId`,
y el template imprimía "undefined". Ahora:
- Nuevo helper `direccionCompletaDeEmpresa` que resuelve por la RELACIÓN:
  empresa.direccionId → catálogo `direcciones` (direccionCompleta), con
  respaldo por texto y por direccionesPorTipo (V00268).
- Si de verdad no hay nada cargado: **"Sin dirección cargada"** (nunca
  más "undefined").
- Aplicado en los 3 módulos que generan documentos (Operaciones,
  Completados y Cancelados; Cancelados ahora carga el catálogo de
  direcciones al generar). La carta porte ya usaba la relación y no se tocó.
Si un origen como KEYLOG2 sigue saliendo "Sin dirección cargada", esa
empresa no tiene Dirección de Facturación ligada en Empresas — al
asignársela, el documento la toma solo.

## Verificación
- `tsc --noEmit`: 0 errores. ESLint: FormularioOperacion 377,
  OperacionesDashboard 127, Completados 163, Cancelados 139 — TODOS
  idénticos a su base.
- `npm run build`: OK (PWA generada).
