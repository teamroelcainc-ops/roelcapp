// src/utils/camposObligatoriosTarifa.ts
// ✅ V00286: CAMPOS OBLIGATORIOS del formulario de tarifa (Agregar/Editar
//   tarifa en los tarifarios de clientes y proveedores). La configuración se
//   guarda en Firestore (configuracion/obligatorios_formulario_tarifa) y por
//   eso es LA MISMA PARA TODOS LOS USUARIOS: quien la cambie con el ⚙, la
//   cambia para todos. La moneda de cotización es obligatoria SIEMPRE por
//   regla de negocio (no se puede desactivar).
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../config/firebase';

export type CamposObligatoriosTarifa = {
  tarifaRefId: boolean;   // Tarifa (catálogo)
  origen: boolean;
  destino: boolean;
  costo: boolean;         // Costo de la Tarifa
  status: boolean;
};

export const OBLIGATORIOS_TARIFA_DEFAULT: CamposObligatoriosTarifa = {
  tarifaRefId: true,
  origen: false,
  destino: false,
  costo: false,
  status: false,
};

export const ETIQUETAS_CAMPOS_TARIFA: Record<keyof CamposObligatoriosTarifa, string> = {
  tarifaRefId: 'Tarifa (catálogo)',
  origen: 'Origen',
  destino: 'Destino',
  costo: 'Costo de la Tarifa',
  status: 'Status',
};

const REF = () => doc(db, 'configuracion', 'obligatorios_formulario_tarifa');

export const cargarObligatoriosTarifa = async (): Promise<CamposObligatoriosTarifa> => {
  try {
    const snap = await getDoc(REF());
    if (!snap.exists()) return { ...OBLIGATORIOS_TARIFA_DEFAULT };
    const d = snap.data() as Partial<CamposObligatoriosTarifa>;
    return { ...OBLIGATORIOS_TARIFA_DEFAULT, ...d };
  } catch { return { ...OBLIGATORIOS_TARIFA_DEFAULT }; }
};

export const guardarObligatoriosTarifa = async (config: CamposObligatoriosTarifa): Promise<void> => {
  await setDoc(REF(), { ...config, actualizadoPor: auth.currentUser?.email || '', actualizadoEl: new Date().toISOString() }, { merge: true });
};
