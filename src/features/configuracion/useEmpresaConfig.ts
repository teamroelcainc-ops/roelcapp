// src/features/configuracion/useEmpresaConfig.ts
//
// Hook reutilizable que lee (en vivo) los datos de la empresa desde Firestore.
// Documento único: colección "configuracion" / documento "empresa".
//
// Uso:
//   const { config, cargando } = useEmpresaConfig();
//   config?.nombre, config?.logoUrl, config?.logoBase64, config?.direccion, ...

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';

export const CONFIG_EMPRESA_COL = 'configuracion';
export const CONFIG_EMPRESA_DOC = 'empresa';

export interface EmpresaConfig {
  nombre?: string;
  logoUrl?: string;
  logoPath?: string;
  // ✅ NUEVO: el logo embebido como dataURL base64. Se guarda al subir el logo y
  // se usa tanto en la app como en los PDF, evitando problemas de CORS al "tintar"
  // el canvas (html2pdf) con una imagen de otro dominio (Firebase Storage).
  logoBase64?: string;
  rfc?: string;
  direccion?: string;
  telefono?: string;
  telefonoAlt?: string;
  email?: string;
  sitioWeb?: string;
  notas?: string;
}

export const useEmpresaConfig = () => {
  const [config, setConfig] = useState<EmpresaConfig | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const ref = doc(db, CONFIG_EMPRESA_COL, CONFIG_EMPRESA_DOC);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setConfig(snap.exists() ? (snap.data() as EmpresaConfig) : null);
        setCargando(false);
      },
      (err) => {
        console.error('Error leyendo configuración de empresa:', err);
        setCargando(false);
      }
    );
    return () => unsub();
  }, []);

  return { config, cargando };
};