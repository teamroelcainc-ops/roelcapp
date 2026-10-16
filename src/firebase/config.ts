import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
/** Firebase Storage: fotos y documentos adjuntos de los registros. */
export const storage = getStorage(app);
// Los correos que envía Firebase (restablecer contraseña, etc.) salen en español.
auth.languageCode = 'es';

/**
 * Caché local persistente (IndexedDB): los datos ya vistos se sirven del
 * disco del navegador en vez de volver a leerse de Firestore. Reduce
 * drásticamente el consumo de lecturas al navegar y al recargar, y permite
 * trabajar sin conexión. `persistentMultipleTabManager` comparte ese caché
 * entre pestañas para no duplicar listeners.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});