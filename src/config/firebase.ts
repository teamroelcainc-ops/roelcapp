// src/config/firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  memoryLocalCache,
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { DocumentData, UpdateData } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Inicializar Firebase (Solo una vez)
const app = initializeApp(firebaseConfig);

// ✅ GUARDIÁN DE ESPACIO: los cachés regenerables de la app (catálogos
//    cat_v1__/cat_v2__, etc.) pueden llenar los ~5MB de localStorage y eso
//    tumbaba la inicialización de Firestore (QuotaExceededError → assertion
//    b815 → app congelada en "Cargando..."). Antes de arrancar, si el
//    almacenamiento viene saturado, se liberan SOLO las claves de caché
//    regenerable (nunca las de sesión de Firebase ni preferencias).
const PREFIJOS_CACHE_REGENERABLE = ['cat_v1__', 'cat_v2__', 'flujo_v1__'];
const liberarEspacioSiEsNecesario = () => {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      total += k.length + (localStorage.getItem(k)?.length || 0);
    }
    // ~3.5MB de umbral (los navegadores dan ~5MB por origen).
    if (total > 3_500_000) {
      const aBorrar: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (PREFIJOS_CACHE_REGENERABLE.some(p => k.startsWith(p))) aBorrar.push(k);
      }
      aBorrar.forEach(k => localStorage.removeItem(k));
      console.warn(`[storage] Se liberaron ${aBorrar.length} cachés regenerables (almacenamiento saturado).`);
    }
  } catch { /* almacenamiento bloqueado: continuar */ }
};
liberarEspacioSiEsNecesario();

// ✅ CACHÉ PERSISTENTE DE FIRESTORE (IndexedDB).
//    · Los datos ya vistos quedan guardados EN EL DISPOSITIVO: al reabrir la
//      app, las vistas pintan al instante desde el caché mientras el SDK
//      sincroniza en segundo plano (sensación de app instalada).
//    · Los listeners onSnapshot sirven primero desde caché (latencia ~0) y
//      solo se facturan lecturas por los documentos que CAMBIARON.
//    · La app funciona offline: consultas y escrituras se encolan y se
//      sincronizan solas al volver la conexión.
//    · persistentSingleTabManager: coordina SIN usar localStorage (el manager
//      multi-pestaña escribía en localStorage y crasheaba con la cuota llena).
//      Si hay varias pestañas, la primera usa persistencia y las demás operan
//      normal contra el servidor.
//    · Si el navegador no permite IndexedDB (p. ej. modo privado estricto),
//      se cae a caché EN MEMORIA y la app sigue funcionando.
let dbInterno: Firestore;
try {
  dbInterno = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }),
  });
} catch (e) {
  console.warn('[firestore] Persistencia no disponible; usando caché en memoria.', e);
  dbInterno = initializeFirestore(app, { localCache: memoryLocalCache() });
}
export const db = dbInterno;

export const auth = getAuth(app);
// ✅ Storage ligado explícitamente a la app principal (mismo proyecto/bucket que db/auth)
export const storage = getStorage(app);

// --- ESTAS SON LAS FUNCIONES CRUD ---
// ✅ Sin `any` en las firmas: aceptan cualquier registro tipado del proyecto.
//    El cast interno a los tipos del SDK está documentado: updateDoc exige
//    índices con notación de punto (`a.b`) que nuestros tipos de dominio no
//    declaran, pero el dato en runtime es un objeto plano válido.

// ✅ NUEVO (V00109) — INVALIDACIÓN CENTRAL DE CACHÉS DE CATÁLOGO: los módulos
//   (Operaciones, Facturación, Estadísticas…) cachean los catálogos en
//   localStorage (cat_v2__*) hasta 24 h. Antes, solo el módulo de Catálogos
//   limpiaba esas cachés; al editar en Bases de Datos (empresas, empleados,
//   unidades…) o Convenios, el resto de la app seguía mostrando valores viejos
//   hasta que la caché expiraba. Ahora, CUALQUIER escritura hecha con estos
//   helpers sobre una colección tipo catálogo borra las cachés locales, y los
//   módulos re-descargan datos frescos en su siguiente carga.
const COLECCIONES_TIPO_CATALOGO = new Set([
  'empresas', 'unidades', 'empleados', 'remolques', 'proveedores_unidad',
  'convenios_clientes', 'convenios_clientes_detalles',
  'convenios_proveedores', 'convenios_proveedores_detalles',
  'tipo_cambio', 'direcciones',
]);
const invalidarCachesCatalogosLocales = (nombreColeccion: string) => {
  try {
    if (!nombreColeccion.startsWith('catalogo_') && !COLECCIONES_TIPO_CATALOGO.has(nombreColeccion)) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('cat_v2__') || k.startsWith('cat_v1__'))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('catalogos_invalidados_en', String(Date.now()));
  } catch { /* almacenamiento no disponible: continuar sin caché */ }
};

export const agregarRegistro = async (nombreColeccion: string, data: object) => {
  const ref = await addDoc(collection(db, nombreColeccion), data as DocumentData);
  invalidarCachesCatalogosLocales(nombreColeccion);
  return ref;
};

export const actualizarRegistro = async (nombreColeccion: string, id: string, data: object) => {
  const res = await updateDoc(doc(db, nombreColeccion, id), data as UpdateData<DocumentData>);
  invalidarCachesCatalogosLocales(nombreColeccion);
  return res;
};

export const eliminarRegistro = async (nombreColeccion: string, id: string, opciones?: OpcionesEliminacion) => {
  // ✅ NUEVO (V00115) — PAPELERA DE RECICLAJE GLOBAL con NOTA OBLIGATORIA:
  //   1) Se pide una nota de eliminación (obligatoria) si el módulo no la
  //      pasó ya en `opciones.motivo`. Cancelar o dejarla vacía ABORTA el
  //      borrado (se lanza error y nada se elimina).
  //   2) Se copia el documento COMPLETO a `papelera_reciclaje` con quién,
  //      cuándo, de qué colección y la nota. La copia va ANTES del borrado:
  //      si la copia falla, no se borra nada.
  //   3) Desde el módulo Papelera de Reciclaje se restaura con su ID original
  //      y datos idénticos.
  //   Los módulos que ya capturan su propia nota la pasan en `opciones.motivo`
  //   para no preguntar dos veces.
  let motivo = String(opciones?.motivo ?? '').trim();
  if (!motivo) {
    motivo = pedirNotaEliminacion();
  }
  const snap = await getDoc(doc(db, nombreColeccion, id));
  if (snap.exists()) {
    await addDoc(collection(db, COL_PAPELERA_GLOBAL), {
      coleccion: nombreColeccion,
      registroId: id,
      datos: snap.data(),
      motivo,
      modulo: opciones?.modulo || nombreColeccion,
      etiqueta: opciones?.etiqueta || '',
      eliminadoPor: auth.currentUser?.email || 'Sistema',
      eliminadoEn: new Date().toISOString(),
    });
  }
  const res = await deleteDoc(doc(db, nombreColeccion, id));
  invalidarCachesCatalogosLocales(nombreColeccion);
  return res;
};

// ✅ NUEVO (V00115) — utilidades de la papelera global (exportadas para los
//   módulos que borran en lote con writeBatch y copian por su cuenta).
export const COL_PAPELERA_GLOBAL = 'papelera_reciclaje';

export interface OpcionesEliminacion {
  /** Nota de eliminación ya capturada por el módulo (evita doble pregunta). */
  motivo?: string;
  /** Nombre del módulo para mostrar en la papelera (por defecto, la colección). */
  modulo?: string;
  /** Descripción corta del registro para identificarlo en la papelera. */
  etiqueta?: string;
}

/** Pide la nota de eliminación obligatoria. Si el usuario cancela o la deja
 *  vacía, lanza un error para ABORTAR el borrado (nada se elimina). */
export const pedirNotaEliminacion = (): string => {
  const nota = window.prompt('Nota de eliminación (obligatoria):\n\nEscribe el motivo por el que se elimina este registro. Quedará guardado en la Papelera de Reciclaje junto con tu usuario y la fecha.', '');
  const limpia = String(nota ?? '').trim();
  if (!limpia) {
    alert('Eliminación cancelada: la nota es obligatoria.');
    throw new Error('Eliminación cancelada (nota obligatoria no capturada)');
  }
  return limpia;
};

/** Construye el documento que va a la papelera global (para borrados en lote). */
export const payloadPapeleraGlobal = (
  coleccion: string,
  registro: { id?: string } & Record<string, unknown>,
  motivo: string,
  modulo?: string,
  etiqueta?: string
) => {
  const { id, ...datos } = registro || {};
  return {
    coleccion,
    registroId: String(id || ''),
    datos,
    motivo,
    modulo: modulo || coleccion,
    etiqueta: etiqueta || '',
    eliminadoPor: auth.currentUser?.email || 'Sistema',
    eliminadoEn: new Date().toISOString(),
  };
};

// --- TRUCO PARA CREAR USUARIOS SIN CERRAR SESIÓN DEL ADMIN ---
// Inicializamos una app secundaria con la misma configuración
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);
