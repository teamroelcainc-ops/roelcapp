// src/features/operaciones/components/formulario/tipoCambioFila.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — T.C. de una fecha en los renglones de tipo_cambio y la
// normalización de fechas que usa el formulario (antes dentro de
// FormularioOperacion.tsx). El respaldo cuando no viene en catalogosCacheados
// está en services/tipoCambioPorFecha (V00438).
// ---------------------------------------------------------------------------

/** Fecha a AAAA-MM-DD (Timestamp, {seconds}, Date, ISO, D/M/AAAA, epoch). '' si no se entiende. */
export const normalizarFechaISO = (valor: unknown): string => {
  if (valor === null || valor === undefined || valor === '') return '';

  if (typeof valor === 'object') {
    try {
      const v = valor as { toDate?: () => Date; seconds?: unknown };
      if (typeof v.toDate === 'function') return v.toDate().toISOString().split('T')[0];
      if (typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString().split('T')[0];
      if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString().split('T')[0];
    } catch { /* sigue abajo */ }
  }

  const s = String(valor).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    const y = dmy[3];
    let dd = a, mm = b;
    if (a <= 12 && b > 12) { mm = a; dd = b; }
    if (mm < 1 || mm > 12) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const d = new Date(n > 1e12 ? n : n * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return '';
};

/** Valor del T.C. de un renglón (columna dof/valor/tc/cambio/monto, o un número entre 5 y 60). */
export const extraerRateDeFilaTC = (row: unknown): number | null => {
  if (!row || typeof row !== 'object') return null;
  const fila = row as Record<string, unknown>;
  const keys = Object.keys(fila);
  const valKey = keys.find((k) => {
    const kk = String(k).toLowerCase();
    return kk.includes('dof') || kk.includes('valor') || kk === 'tc' ||
           kk.includes('cambio') || kk.includes('monto') || kk.includes('t.c');
  });
  if (valKey) {
    const n = Number(String(fila[valKey]).replace(/[^0-9.-]+/g, ''));
    if (!isNaN(n) && n > 0) return n;
  }
  const posibles = Object.values(fila)
    .map((v) => parseFloat(String(v).replace(/[^0-9.-]+/g, '')))
    .filter((n) => !isNaN(n) && n > 5 && n < 60);
  return posibles.length > 0 ? posibles[0] : null;
};

export const filaTCEsDeLaFecha = (row: unknown, objetivoISO: string): boolean => {
  if (!objetivoISO || !row || typeof row !== 'object') return false;
  return Object.values(row as Record<string, unknown>).some((v) => normalizarFechaISO(v) === objetivoISO);
};

/** ✅ V00439 (Fase 3.6): T.C. de una fecha en una lista de renglones de tipo_cambio. */
export const buscarTCDeFecha = (fuente: unknown, objetivoISO: string): number | null => {
  for (const row of (Array.isArray(fuente) ? fuente : [])) {
    if (filaTCEsDeLaFecha(row, objetivoISO)) {
      const r = extraerRateDeFilaTC(row);
      if (r !== null) return r;
    }
  }
  return null;
};
