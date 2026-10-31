// src/features/operaciones/components/FormularioOperacionDiferido.tsx
// ---------------------------------------------------------------------------
// ✅ V00534 — EL FORMULARIO DE OPERACIÓN SE CARGA APARTE. FormularioOperacion (~300 KB sin comprimir) y
// lo que arrastra (FormularioEmpresa, EmployeeForm, FormularioDireccion, Costos adicionales…) iban
// estáticos en Operaciones Activas, Completados, Cancelados, Estadísticas, Nómina, Puentes,
// Convenios y, por EditorOperacionEmbebido, en Facturación: cada pantalla los bajaba al abrirse
// aunque nadie editara. Ahora se bajan una vez, en segundo plano después de pintar la pantalla
// (precargarFormularioOperacion de services/cargarFormularioOperacion.ts con usePrecargarAlPintar), así el ✎ sigue abriendo al instante.
// Mientras llega (si alguien da clic antes), se ve "Abriendo el formulario…".
// ---------------------------------------------------------------------------
import { Suspense } from 'react';
import type { ComponentProps } from 'react';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import type { FormularioOperacion } from './FormularioOperacion';
import { cargarFormularioOperacion } from '../services/cargarFormularioOperacion';

const FormularioOperacionPerezoso = lazyWithRetry(
  () => cargarFormularioOperacion().then((modulo) => ({ default: modulo.FormularioOperacion })),
  'FormularioOperacion',
);

type FormularioOperacionDiferidoProps = ComponentProps<typeof FormularioOperacion>;

/** Igual que <FormularioOperacion>, con su código cargado aparte. */
const FormularioOperacionDiferido = (props: FormularioOperacionDiferidoProps) => (
  <Suspense fallback={<CargandoDatos texto="Abriendo el formulario…" />}>
    <FormularioOperacionPerezoso {...props} />
  </Suspense>
);

export default FormularioOperacionDiferido;
