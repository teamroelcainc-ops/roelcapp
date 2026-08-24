// src/features/operaciones/services/catalogosOperacion.ts
// ✅ V00126: carga (con caché en memoria) de TODOS los catálogos que necesita
//   FormularioOperacion, para poder abrir el formulario desde Facturación y Pagos
//   (misma lista de alias que usa OperacionesDashboard).
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';

export const COLECCIONES_CATALOGOS_OPERACION: Record<string, string> = {
  statusServicio:            'catalogo_status_servicio',
  tiposOperacion:            'catalogo_tipo_operacion',
  embalajes:                 'catalogo_embalaje',
  catalogoMoneda:            'catalogo_moneda',
  tarifas:                   'catalogo_tarifas_referencia',
  empresas:                  'empresas',
  remolques:                 'remolques',
  unidades:                  'unidades',
  empleados:                 'empleados',
  unidades_proveedor:        'unidades_proveedor',
  proveedores_unidad:        'proveedores_unidad',
  conveniosProv:             'convenios_proveedores',
  catalogoConvProvDetalles:  'convenios_proveedores_detalles',
  catalogoConvClientes:      'convenios_clientes',
  catalogoConvDetalles:      'convenios_clientes_detalles',
  catalogoTC:                'tipo_cambio',
  direcciones:               'direcciones',
};

const TTL_MS = 5 * 60 * 1000;
let cache: { ts: number; data: Record<string, any[]> } | null = null;
let enVuelo: Promise<Record<string, any[]>> | null = null;

export const cargarCatalogosParaFormulario = async (forzar = false): Promise<Record<string, any[]>> => {
  if (!forzar && cache && Date.now() - cache.ts < TTL_MS) return cache.data;
  if (enVuelo) return enVuelo;
  enVuelo = (async () => {
    const entradas = Object.entries(COLECCIONES_CATALOGOS_OPERACION);
    const resultados = await Promise.all(entradas.map(async ([alias, col]) => {
      try {
        const snap = await getDocs(collection(db, col));
        return [alias, snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))] as const;
      } catch (e) { console.warn(`[catalogosOperacion] no se pudo cargar "${col}":`, e); return [alias, []] as const; }
    }));
    const data = Object.fromEntries(resultados);
    cache = { ts: Date.now(), data };
    enVuelo = null;
    return data;
  })();
  return enVuelo;
};

export const invalidarCatalogosParaFormulario = () => { cache = null; };
