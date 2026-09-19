// src/utils/verEnPestana.ts
// ---------------------------------------------------------------------------
// ✅ V00312: "↗ Ver en nueva pestaña" GENÉRICO — serializa los filtros del
// módulo en la URL (?modulo=…&filtros=…) para abrir el MISMO resultado en
// otra pestaña. App.tsx ya honra ?modulo= (deep-link V00293); cada módulo lee
// sus filtros al montar con filtrosDeUrl. Conectar un módulo nuevo son dos
// líneas: el <a href={urlVerEnPestana(...)}> y el filtrosDeUrl al montar.
// ---------------------------------------------------------------------------

/** URL que abre el módulo con estos filtros aplicados. */
export const urlVerEnPestana = (modulo: string, filtros: Record<string, unknown>): string =>
  `${window.location.pathname}?modulo=${modulo}&filtros=${encodeURIComponent(JSON.stringify(filtros))}`;

/** Filtros que llegaron por la URL para ESTE módulo (o null si no hay). */
export const filtrosDeUrl = <T = Record<string, unknown>>(modulo: string): T | null => {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('modulo') !== modulo) return null;
    const f = p.get('filtros'); // URLSearchParams ya decodifica los %xx
    return f ? (JSON.parse(f) as T) : null;
  } catch { return null; }
};
