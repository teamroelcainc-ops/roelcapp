// src/features/operaciones/services/volverARevision.ts
// ---------------------------------------------------------------------------
// ✅ V00540 — Volver a la Revisión de datos donde estaba. "Solucionar" de F5 (terminadas sin facturar) va a
//   Facturación de Clientes; al regresar a Operaciones la ventana se vuelve a abrir sola, en el mismo grupo y
//   en la misma posición de la lista. En memoria durante la sesión. Sin dependencias: lo lee la barra de
//   pestañas de Operaciones, que se carga con la pantalla (la ventana y sus lecturas se cargan al abrirla).
// ---------------------------------------------------------------------------

export interface PosicionRevision {
  /** Código del grupo que se estaba viendo (F5…). */
  grupo: string;
  /** Cuántas filas se mostraban ("Mostrar más"). */
  mostrar: number;
  /** Desplazamiento de la lista del grupo y del cuerpo de la ventana (en celular se desplaza el cuerpo). */
  scrollLista: number;
  scrollCuerpo: number;
}

let posicion: PosicionRevision | null = null;

/** Se sale de la ventana a otro módulo: al volver a Operaciones se reabre en esta posición. */
export const salirDeRevision = (p: PosicionRevision): void => { posicion = p; };

/** ¿Hay que reabrir la ventana al volver a Operaciones? */
export const hayQueReabrirRevision = (): boolean => posicion !== null;

/** Dónde estaba la ventana (null = no se salió de ella). */
export const posicionRevision = (): PosicionRevision | null => posicion;

/** La ventana ya se reabrió (o se abrió a mano): se olvida la posición. */
export const olvidarPosicionRevision = (): void => { posicion = null; };
