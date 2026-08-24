// src/features/operaciones/components/EditorOperacionEmbebido.tsx
// ✅ V00126: abre FormularioOperacion desde cualquier módulo (Facturación, Pagos)
//   cargando por sí mismo los catálogos que el formulario necesita. Así se
//   respeta el hilo Operaciones → Facturación → Pagos: la operación se edita en
//   el MISMO formulario y el bus `operacionesBus` refresca las demás vistas.
import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { FormularioOperacion } from './FormularioOperacion';
import { cargarCatalogosParaFormulario } from '../services/catalogosOperacion';
import './EditorOperacionEmbebido.css';

interface Props {
  /** Id de la operación a editar (se relee de Firestore para traer la versión más reciente). */
  operacionId: string;
  /** Datos ya conocidos (se usan mientras se relee). */
  operacion?: any;
  onClose: () => void;
  onSave?: (data: any) => void;
}

export const EditorOperacionEmbebido: React.FC<Props> = ({ operacionId, operacion, onClose, onSave }) => {
  const [catalogos, setCatalogos] = useState<Record<string, any[]> | null>(null);
  const [op, setOp] = useState<any>(operacion || null);
  const [estado, setEstado] = useState<'abierto' | 'minimizado'>('abierto');
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [cats, snap] = await Promise.all([
          cargarCatalogosParaFormulario(),
          getDoc(doc(db, 'operaciones', String(operacionId))),
        ]);
        if (!activo) return;
        if (snap.exists()) setOp({ id: snap.id, ...(snap.data() as any) });
        else if (!operacion) { setError('La operación ya no existe en la base de datos.'); return; }
        setCatalogos(cats);
      } catch (e: any) {
        if (activo) setError(`No se pudieron cargar los catálogos: ${e?.message || String(e)}`);
      }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionId]);

  if (error) {
    return (
      <div className="modal-overlay eoe-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="form-card eoe-card"><p className="eoe-error">{error}</p><button className="btn btn-outline" onClick={onClose}>Cerrar</button></div>
      </div>
    );
  }
  if (!catalogos || !op) {
    return (
      <div className="modal-overlay eoe-overlay">
        <div className="form-card eoe-card"><p className="eoe-cargando">⏳ Cargando la operación y sus catálogos…</p></div>
      </div>
    );
  }
  return (
    <FormularioOperacion
      estado={estado}
      initialData={op}
      catalogosCacheados={catalogos}
      onClose={onClose}
      onMinimize={() => setEstado('minimizado')}
      onRestore={() => setEstado('abierto')}
      onSave={(data: any) => { onSave?.(data); }}
    />
  );
};
