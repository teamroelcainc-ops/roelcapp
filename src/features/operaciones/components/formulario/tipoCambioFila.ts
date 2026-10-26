// src/features/operaciones/components/formulario/tipoCambioFila.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — T.C. de una fecha en los renglones de tipo_cambio y la
// normalización de fechas que usa el formulario (antes dentro de
// FormularioOperacion.tsx). El respaldo cuando no viene en catalogosCacheados
// está en services/tipoCambioPorFecha (V00438).
// ---------------------------------------------------------------------------
import { mismoTipoCambio, tipoCambioAplicable, tipoCambioDeFecha, valorDeTipoCambio } from '../../../../shared/dominio/tipoCambio';

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

// ✅ V00461: el renglón de una fecha se reconoce por su campo `fecha` (regla compartida en
//   shared/dominio/tipoCambio.ts). Antes valía CUALQUIER campo con fecha, y el createdAt en UTC
//   de un T.C. capturado en la noche lo hacía pasar por el del día siguiente.
/** Valor del T.C. de un renglón (columna dof/valor/tc/cambio/monto, o un número entre 5 y 60). */
export const extraerRateDeFilaTC = valorDeTipoCambio;

/** ✅ V00439 (Fase 3.6) · V00461: T.C. de una fecha en una lista de renglones de tipo_cambio. */
export const buscarTCDeFecha = (fuente: unknown, objetivoISO: string): number | null => tipoCambioDeFecha(fuente, objetivoISO);

/** ✅ V00461: el T.C. que le toca a la fecha (sábado/domingo sin registro → el del viernes) y de qué día es. */
export const buscarTCAplicable = (fuente: unknown, objetivoISO: string): { valor: number; fecha: string } | null =>
  tipoCambioAplicable((f) => tipoCambioDeFecha(fuente, f), objetivoISO);

/**
 * ✅ V00462: T.C. de una operación GUARDADA abierta en su propia fecha (sin cambiarla). Regla del
 * negocio: el T.C. de la operación es el oficial de su fecha de servicio, también al abrirla.
 * · Su fecha no tiene T.C. registrado → se queda el que trae (null = no cambiar).
 * · Trae 0 o trae otro → el oficial.
 * · Excepto: ya facturada (cambiaría una factura emitida: solo se avisa) o editado a mano en esta sesión.
 * ✅ V00494: facturada NUNCA se cambia sola, aunque traiga 0 (antes con 0 tomaba el oficial y, al
 *   guardar, la factura cambiaba de monto sin que nadie lo pidiera). "Usar oficial" sigue a mano.
 */
export const tcParaOperacionGuardada = (p: { actual: number; oficial: number | null; facturada: boolean; editadoAMano: boolean }): number | null => {
  if (p.oficial === null || p.facturada) return null;
  if (!(p.actual > 0)) return p.oficial;
  if (mismoTipoCambio(p.actual, p.oficial) || p.facturada || p.editadoAMano) return null;
  return p.oficial;
};
