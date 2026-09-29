import { useEffect, useState } from 'react';
import bundledLogo from '../../assets/logo.svg';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';

interface BrandLogoProps {
  size: number;
  className?: string;
  alt?: string;
}

/**
 * Logo de la marca. Busca en orden `public/logo.png`, `public/logo.svg` y por
 * último el logo incluido en el código, así que para cambiarlo basta con dejar
 * el archivo en `public/` — sin tocar nada más. Se muestra tal cual, sin
 * filtros de color, para respetar los colores originales.
 */
export function BrandLogo({ size, className, alt = 'ServiExpress' }: BrandLogoProps) {
  const { logoUrl } = useCompanyProfile();
  // El logo subido en "Company" manda; si no hay, los archivos de public/ y
  // por último el incluido en el código.
  const sources = [
    ...(logoUrl ? [logoUrl] : []),
    '/logo.png',
    '/logo.jpg',
    '/logo.svg',
    bundledLogo,
  ];
  const [index, setIndex] = useState(0);
  // Al cambiar el logo configurado, volver a la primera fuente.
  useEffect(() => {
    setIndex(0);
  }, [logoUrl]);

  return (
    <img
      src={sources[index]}
      alt={alt}
      width={size}
      height={size}
      className={className}
      onError={() => setIndex((current) => Math.min(current + 1, sources.length - 1))}
    />
  );
}