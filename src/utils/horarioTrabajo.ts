// src/utils/horarioTrabajo.ts
// Horario de trabajo semanal por usuario (se captura en el módulo Usuarios y
// lo consumen el Reloj Checador y la alerta global de "no has marcado").
export interface HorarioDia {
  activo: boolean;   // ¿labora este día?
  entrada: string;   // "HH:MM" (24h)
  salida: string;    // "HH:MM" (24h)
}

export type HorarioTrabajo = Record<string, HorarioDia>;

export const DIAS_SEMANA: { clave: string; etiqueta: string }[] = [
  { clave: 'lun', etiqueta: 'Lunes' },
  { clave: 'mar', etiqueta: 'Martes' },
  { clave: 'mie', etiqueta: 'Miércoles' },
  { clave: 'jue', etiqueta: 'Jueves' },
  { clave: 'vie', etiqueta: 'Viernes' },
  { clave: 'sab', etiqueta: 'Sábado' },
  { clave: 'dom', etiqueta: 'Domingo' },
];

export const HORARIO_VACIO: HorarioTrabajo = DIAS_SEMANA.reduce((acc, d) => {
  acc[d.clave] = { activo: false, entrada: '', salida: '' };
  return acc;
}, {} as HorarioTrabajo);

// Tolerancia (en minutos) para considerar una marca "a tiempo".
export const TOLERANCIA_MINUTOS = 5;

export const claveDiaDeFecha = (fecha: Date): string =>
  ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][fecha.getDay()];

export const etiquetaDia = (clave: string): string =>
  DIAS_SEMANA.find(d => d.clave === clave)?.etiqueta || clave;

const aMinutos = (hhmm: string): number | null => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Horario del día de la fecha dada (null si no labora o no está configurado). */
export const horarioDeHoy = (
  horario: HorarioTrabajo | null | undefined,
  fecha: Date = new Date()
): HorarioDia | null => {
  const dia = horario?.[claveDiaDeFecha(fecha)];
  if (!dia || !dia.activo) return null;
  if (aMinutos(dia.entrada) == null || aMinutos(dia.salida) == null) return null;
  return dia;
};

export interface EvaluacionMarcaje {
  diferenciaMinutos: number;   // negativo = antes; positivo = después
  mensaje: string;             // mensaje personalizado para el colaborador
  fueraDeHorario: boolean;
}

/** Evalúa una marca del checador contra el horario del día. */
export const evaluarMarcaje = (
  tipoRegistro: string,
  fecha: Date,
  dia: HorarioDia
): EvaluacionMarcaje | null => {
  const ahoraMin = fecha.getHours() * 60 + fecha.getMinutes();
  const entradaMin = aMinutos(dia.entrada);
  const salidaMin = aMinutos(dia.salida);
  if (entradaMin == null || salidaMin == null) return null;

  if (tipoRegistro === 'Llegada al Turno') {
    const dif = ahoraMin - entradaMin;
    if (dif < -TOLERANCIA_MINUTOS) {
      return { diferenciaMinutos: dif, fueraDeHorario: false, mensaje: `Marcaste ${-dif} min ANTES de tu hora de entrada (${dia.entrada}).` };
    }
    if (dif > TOLERANCIA_MINUTOS) {
      return { diferenciaMinutos: dif, fueraDeHorario: true, mensaje: `Marcaste ${dif} min DESPUÉS de tu hora de entrada (${dia.entrada}).` };
    }
    return { diferenciaMinutos: dif, fueraDeHorario: false, mensaje: `Llegada a tiempo. Tu entrada es a las ${dia.entrada}.` };
  }

  if (tipoRegistro === 'Salida del Turno') {
    const dif = ahoraMin - salidaMin;
    if (dif < -TOLERANCIA_MINUTOS) {
      return { diferenciaMinutos: dif, fueraDeHorario: true, mensaje: `Marcaste ${-dif} min ANTES de tu hora de salida (${dia.salida}).` };
    }
    if (dif > TOLERANCIA_MINUTOS) {
      return { diferenciaMinutos: dif, fueraDeHorario: true, mensaje: `Marcaste ${dif} min DESPUÉS de tu hora de salida (${dia.salida}) — fuera de tu horario.` };
    }
    return { diferenciaMinutos: dif, fueraDeHorario: false, mensaje: `Salida a tiempo. Tu salida es a las ${dia.salida}.` };
  }

  // Comida u otros: solo se avisa si la marca cae fuera del rango del día.
  if (ahoraMin < entradaMin || ahoraMin > salidaMin) {
    const dif = ahoraMin < entradaMin ? ahoraMin - entradaMin : ahoraMin - salidaMin;
    return { diferenciaMinutos: dif, fueraDeHorario: true, mensaje: `Marcaste fuera de tu horario (${dia.entrada} – ${dia.salida}).` };
  }
  return null;
};
