// src/features/operaciones/context/FormularioOperacionContext.tsx
//
// Context que monta el FormularioOperacion a NIVEL DE LAYOUT RAÍZ, de modo que
// la ventana (abierta o minimizada) sobrevive al cambio de pestañas del menú.
//
// Garantiza que solo exista UN formulario de operaciones a la vez (es un singleton).
//
// USO:
//   1. Envolver tu layout raíz con <FormularioOperacionProvider catalogos={...} onSaved={...}>
//   2. En cualquier componente (ej. OperacionesDashboard) llamar:
//        const { abrir, editar } = useFormularioOperacion();
//        abrir();          // nueva operación
//        editar(operacion) // editar existente

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { FormularioOperacion } from '../components/FormularioOperacion';

type EstadoFormulario = 'cerrado' | 'abierto' | 'minimizado';

interface FormularioOperacionContextValue {
  estado: EstadoFormulario;
  operacionEditando: any | null;
  abrir: () => void;
  editar: (operacion: any) => void;
  cerrar: () => void;
  minimizar: () => void;
  restaurar: () => void;
}

const FormularioOperacionContext = createContext<FormularioOperacionContextValue | null>(null);

export const useFormularioOperacion = () => {
  const ctx = useContext(FormularioOperacionContext);
  if (!ctx) {
    throw new Error('useFormularioOperacion debe usarse dentro de <FormularioOperacionProvider>');
  }
  return ctx;
};

interface ProviderProps {
  children: ReactNode;
  /**
   * Catálogos cacheados globales (los mismos que pasabas a <FormularioOperacion catalogosCacheados=...>).
   * El layout raíz debe proporcionarlos. Si aún no están cargados, pasa {} y el formulario
   * mostrará "Cargando catálogos...".
   */
  catalogos: any;
  /**
   * Callback que se ejecuta cuando una operación se guarda/actualiza correctamente.
   * Úsalo para refrescar la tabla del dashboard.
   */
  onSaved?: (operacion: any) => void;
}

export const FormularioOperacionProvider: React.FC<ProviderProps> = ({ children, catalogos, onSaved }) => {
  const [estado, setEstado] = useState<EstadoFormulario>('cerrado');
  const [operacionEditando, setOperacionEditando] = useState<any | null>(null);

  const abrir = useCallback(() => {
    setOperacionEditando(null);
    setEstado('abierto');
  }, []);

  const editar = useCallback((operacion: any) => {
    setOperacionEditando(operacion);
    setEstado('abierto');
  }, []);

  const cerrar = useCallback(() => {
    setEstado('cerrado');
    setOperacionEditando(null);
  }, []);

  const minimizar = useCallback(() => setEstado('minimizado'), []);
  const restaurar = useCallback(() => setEstado('abierto'), []);

  const handleSave = useCallback((op: any) => {
    if (onSaved) onSaved(op);
    setEstado('cerrado');
    setOperacionEditando(null);
  }, [onSaved]);

  return (
    <FormularioOperacionContext.Provider
      value={{ estado, operacionEditando, abrir, editar, cerrar, minimizar, restaurar }}
    >
      {children}

      {/* El formulario vive aquí, fuera de cualquier pestaña, por eso persiste */}
      {estado !== 'cerrado' && (
        <FormularioOperacion
          estado={estado === 'minimizado' ? 'minimizado' : 'abierto'}
          initialData={operacionEditando}
          catalogosCacheados={catalogos}
          onClose={cerrar}
          onMinimize={minimizar}
          onRestore={restaurar}
          onSave={handleSave}
        />
      )}
    </FormularioOperacionContext.Provider>
  );
};