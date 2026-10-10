// src/shared/data/callables.ts
// ---------------------------------------------------------------------------
// ✅ V00437 — Llamar Cloud Functions "callable" (región us-central1).
// `firebase/functions` se carga bajo demanda: solo pesa cuando alguien la usa.
// Los mensajes de HttpsError del servidor ya vienen en español y se pueden
// mostrar tal cual.
// ---------------------------------------------------------------------------
export class ErrorCallable extends Error {
  readonly codigo: string;
  constructor(mensaje: string, codigo: string) {
    super(mensaje);
    this.name = 'ErrorCallable';
    this.codigo = codigo;
  }
}

/** Llama la callable `nombre` con `datos` y devuelve su respuesta. */
export async function llamarCallable<TRespuesta, TDatos = unknown>(nombre: string, datos: TDatos): Promise<TRespuesta> {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  try {
    const fn = httpsCallable<TDatos, TRespuesta>(getFunctions(undefined, 'us-central1'), nombre);
    const res = await fn(datos);
    return res.data;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const codigo = String(err.code ?? 'desconocido').replace(/^functions\//, '');
    // `not-found` sin mensaje propio = la función no existe en el servidor.
    const generico = !err.message || /^not[-_ ]?found$/i.test(err.message.trim());
    const mensaje = codigo === 'not-found' && generico
      ? `La función "${nombre}" no está desplegada. Despliega las Cloud Functions (firebase deploy --only functions).`
      : (err.message || `No se pudo completar "${nombre}".`);
    throw new ErrorCallable(mensaje, codigo);
  }
}
