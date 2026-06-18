// src/features/configuracion/EmpresaBrand.tsx
//
// Muestra el logo y el nombre de la empresa (leídos de la configuración).
// Si aún no hay logo cargado, muestra el cuadrado naranja como respaldo.
//
// Colócalo en el encabezado del menú lateral, donde hoy está el cuadrado
// naranja + "Roelca Inc.".
//
// Uso:
//   <EmpresaBrand />              // logo + nombre
//   <EmpresaBrand soloLogo />     // solo el logo (menú colapsado)

import React from 'react';
import { useEmpresaConfig } from './useEmpresaConfig';

interface EmpresaBrandProps {
  soloLogo?: boolean;            // si true, no muestra el nombre (menú colapsado)
  tamanoLogo?: number;           // px del logo (default 26)
  colorNombre?: string;          // color del texto del nombre
}

export const EmpresaBrand: React.FC<EmpresaBrandProps> = ({ soloLogo = false, tamanoLogo = 26, colorNombre = '#f0f6fc' }) => {
  const { config } = useEmpresaConfig();
  const nombre = config?.nombre || 'Roelca Inc.';
  // ✅ Preferimos el logo en base64 (misma fuente que usan los PDF); si no hay,
  // caemos a la URL de Storage.
  const logoSrc = config?.logoBase64 || config?.logoUrl || '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={nombre}
          style={{ width: `${tamanoLogo}px`, height: `${tamanoLogo}px`, borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        // Respaldo: cuadrado naranja (igual al actual) mientras no haya logo
        <div style={{ width: `${tamanoLogo - 4}px`, height: `${tamanoLogo - 4}px`, borderRadius: '4px', backgroundColor: '#D84315', flexShrink: 0 }} />
      )}
      {!soloLogo && (
        <span style={{ color: colorNombre, fontWeight: 700, fontSize: '1.05rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nombre}
        </span>
      )}
    </div>
  );
};