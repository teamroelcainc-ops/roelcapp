// src/features/operaciones/components/completados/formatos.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — formatos puros de Servicios Completados (antes dentro de
// ServiciosCompletados.tsx). Los que también usan Operaciones y Cancelados están en
// services/formatosOperacion.ts.
// ---------------------------------------------------------------------------

export const describirFiltrosLog = (f: { fechaInicio: string; fechaFin: string; cliente?: string; clienteNombre?: string; tipoOperacion?: string; movimiento?: string; cargaVacia?: string; aduana?: string; remolque?: string; remolqueNombre?: string; operador?: string; operadorNombre?: string; referencia?: string; busqueda?: string }): string => { // ✅ V00256
  const partes: string[] = [`Fechas: ${f.fechaInicio} a ${f.fechaFin}`];
  if (f.cliente) partes.push(`Cliente: ${f.clienteNombre || f.cliente}`);
  if (f.tipoOperacion) partes.push(`Tipo de operación: ${f.tipoOperacion}`);
  if (f.movimiento) partes.push(`Movimiento: ${f.movimiento === 'expo' ? 'Exportación' : f.movimiento === 'impo' ? 'Importación' : 'Movimiento'}`); // ✅ V00256
  if (f.cargaVacia) partes.push(`C/V: ${f.cargaVacia}`); // ✅ V00256
  if (f.aduana) partes.push(`Aduana: ${f.aduana}`); // ✅ V00256
  if (f.remolque) partes.push(`Remolque: ${f.remolqueNombre || f.remolque}`);
  if (f.operador) partes.push(`Operador: ${f.operadorNombre || f.operador}`);
  if (f.referencia && f.referencia.trim()) partes.push(`# Referencia: "${f.referencia.trim()}"`);
  if (f.busqueda && f.busqueda.trim()) partes.push(`Filtro general: "${f.busqueda.trim()}"`);
  return partes.join(' | ');
};

// ✅ V00355: saldo del puente colocado al completar (AVI import / Puente III export)
export const fmtSaldoPuente = (op: { saldoPuente?: unknown; saldoPuenteMoneda?: unknown; saldoPuentePiso?: unknown; saldoPuentePisoMoneda?: unknown }): string => {
  const n = Number(op?.saldoPuente); if (!Number.isFinite(n)) return '-';
  const f = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const piso = Number(op?.saldoPuentePiso); // ✅ V00388: aduana Colombia = caseta + piso del puente
  return `$${f(n)} ${String(op?.saldoPuenteMoneda || '')}${piso > 0 ? ` + $${f(piso)} ${String(op?.saldoPuentePisoMoneda || '')}` : ''}`.trim();
};

// ✅ NUEVO: normaliza nombres de moneda inconsistentes en la base
//   ("Dolares" / "Dólares" / "DOLARES" → "Dólares"; "pesos" → "Pesos").
export const normalizarMoneda = (txt: unknown): string => {
  const t = String(txt ?? '').trim();
  if (!t || t === '-') return t;
  const plano = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (plano.includes('dolar')) return 'Dólares';
  if (plano.includes('peso')) return 'Pesos';
  return t;
};

// ✅ NUEVO: normaliza CUALQUIER formato de fecha de servicio a "YYYY-MM-DD".
//   Los registros migrados/viejos pueden guardar la fecha como Timestamp de
//   Firestore, objeto Date, número epoch o texto "DD/MM/YYYY" / "MM/DD/YYYY".
//   Sin esta normalización, el filtro por rango fallaba y no mostraba nada.
export const normalizarFechaServicioISO = (valor: unknown): string => {
  if (valor === null || valor === undefined || valor === '') return '';

  // Timestamp de Firestore u objeto con toDate()/seconds.
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

  // Ya viene en ISO ("2026-06-25" o "2026-06-25T10:30:00").
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Formatos con barras o guiones: DD/MM/YYYY (latino) o MM/DD/YYYY.
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    const y = dmy[3];
    let dd = a, mm = b;            // Por defecto se asume DD/MM (formato latino).
    if (a <= 12 && b > 12) { mm = a; dd = b; }   // Si el 2º > 12 era MM/DD.
    if (mm < 1 || mm > 12) return s;             // Formato no reconocible.
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  // Número epoch (ms o s).
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const d = new Date(n > 1e12 ? n : n * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  // Último intento: que lo resuelva el motor de fechas del navegador.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return s;
};
