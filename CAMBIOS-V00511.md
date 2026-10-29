# V00511 — Falso al 50%, sueldo fijo y 3 galones · Nómina con el convenio

**Solo web.** Va encima de la V00510. Sin funciones, reglas, índices ni banderas. **Aplícala después de correr F1** (V00510).

## Qué cambia

### 1. Operación en Falso
Cuando una operación entra a un estatus Falso:

| Qué | Antes | Ahora |
|---|---|---|
| Cobro al cliente | Se cambiaba al convenio Falso del cliente (V00509) | **Mismo convenio al 50%** |
| Pago al proveedor | Sin cambio | **Su convenio al 50%** |
| Sueldo del operador | La mitad | **$200** en cruce de importación o exportación · **$150** en movimiento · sin clasificar: no se toca |
| Diesel | Sin cambio | **3 galones** |

- Por Cobrar, Por Pagar y la utilidad estimada se recalculan solos. Los cargos adicionales no cambian.
- Si la operación **sale** de Falso (Regresar estatus o deshacer la marca), todo **regresa a como estaba**.
- **No se toca:**
  - un lado que ya está **facturado**: avisa que lo ajustes en su factura;
  - el cobro de una operación que ya trae un convenio "Falso";
  - montos, sueldos o diesel en 0.

  El sueldo y el diesel tampoco suben: si ya eran menores, se quedan.
- **Solo de aquí en adelante:** las operaciones que hoy ya están en Falso se quedan como están.
- Al regresar un estatus, la ventana ya dice qué va a cambiar: el sueldo, el diesel y el cobro al 50%. Al aplicar sale un aviso "Falso al 50%".
- Funciona en todos los lugares donde se cambia el estatus: Operaciones Activas, Canceladas, Regresar estatus, el formulario y Mis Operaciones.

### 2. Nómina
En la ficha de una nómina, la tabla "Operaciones pagadas en esta nómina" muestra el **Convenio** (sin el monto) en lugar del Cliente. El cliente queda al pasar el mouse.

## Pasos manuales
1. Primero termina F1 con la V00510.
2. Aplica el zip encima de la V00510 (no hay archivos borrados) y haz el commit: el conteo debe dar **17**.
3. Push y publicar: `npm run build` y `npx wrangler deploy`. No hay que desplegar funciones.

## Para probar
1. En una operación de cruce con proveedor, ve a Regresar estatus → 7. Falso. La ventana dice: sueldo $200, diesel 3 galones, cliente y proveedor al 50%.
2. Aplica y revisa Por Cobrar y Por Pagar.
3. Regresa a Completado: todo vuelve al 100%.
4. Ve a Nómina → Historial → Ver ficha: la columna dice Convenio.

## Técnico
- `convenioFalso.ts`: es la regla pura.
  - Respaldo en `mitadFalso`.
  - Recalcula con `conversionOperacion`. Si falta el T.C., escala lo que ya estaba guardado.
  - Sigue siendo compatible con `convenioAntesFalso` de la V00509.
- `convenioFalsoDatos.ts`: ya no lee catálogos.
- `regresoStatusDatos.ts`: calcula dentro de la transacción.
- `utils/sueldoFalso.ts`: `ajusteOperadorPorStatus`.
  - Sueldo fijo según `movimientoDeOperacion`.
  - Combustible a 3, con `combustibleCompleto` y `combustibleFalsoAplicado`.
- `FormularioOperacion.tsx`: al cambiar o actualizar el convenio, se limpia `combustibleFalsoAplicado`.
- `ReferenciasNominaDashboard.tsx`: columna Convenio.
- Simulador (completada → 7. Falso → Completado):

  | Campo | Al entrar a Falso | Al salir |
  |---|---|---|
  | Cliente | 120 → 60 USD (conversión 2160 → 1080) | 120, 2160 |
  | Proveedor | 80 → 40 USD (1440 → 720) | 80, 1440 |
  | Utilidad | 720 → 360 | 720 |
  | Sueldo | 400 → 200 | 400 |
  | Diesel | 6 → 3 galones | 6 |
  | `mitadFalso` | se guarda | null |

  En la ficha de nómina se ven el convenio guardado sin monto y, para una operación sin convenio guardado, el de la operación en vivo.
- Pendiente conocido, igual que el sueldo desde la V00387: si Roelca Móvil marca Falso, no aplica esta regla, porque solo escribe el estatus.
