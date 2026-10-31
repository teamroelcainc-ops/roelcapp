// src/features/operaciones/components/SolucionarPlanes.tsx
// ---------------------------------------------------------------------------
// ✅ V00539 — Panel "Solucionar" de un grupo de la Revisión de datos cuyo plan ya lo armó la revisión
// (D2 renumerar, F3 ligar o liberar): qué se va a hacer, las que quedan a mano con su motivo y los
// pasos (PasosCorreccion: prueba, respaldo, APLICAR).
// ---------------------------------------------------------------------------
import type { ComponentProps, ReactNode } from 'react';
import { Wrench } from 'lucide-react';
import PasosCorreccion from './PasosCorreccion';
import './SolucionarPlanes.css';

const miles = (n: number): string => n.toLocaleString('es-MX');

interface ManualPlan { id: string; ref: string; motivo: string }

interface SolucionarPlanesProps {
  /** Qué hace el botón (una o dos oraciones). */
  explicacion: ReactNode;
  /** Resumen: "N se renumeran", etc. */
  resumen: ReactNode;
  manuales: readonly ManualPlan[];
  pasos: ComponentProps<typeof PasosCorreccion>;
}

const MAX_MANUALES = 30;

const SolucionarPlanes = ({ explicacion, resumen, manuales, pasos }: SolucionarPlanesProps) => (
  <section className="spl-panel" aria-label="Solucionar">
    <h4 className="spl-titulo"><Wrench size={14} aria-hidden="true" /> Solucionar</h4>
    <p className="spl-texto">{explicacion}</p>
    <p className="spl-texto">{resumen}</p>
    {manuales.length > 0 && (
      <ul className="spl-mano" aria-label="Quedan a mano">
        {manuales.slice(0, MAX_MANUALES).map((m) => <li key={m.id}><b>{m.ref}</b>: {m.motivo}</li>)}
        {manuales.length > MAX_MANUALES && <li>… y {miles(manuales.length - MAX_MANUALES)} más (todas en la prueba).</li>}
      </ul>
    )}
    <PasosCorreccion {...pasos} />
  </section>
);

export default SolucionarPlanes;
