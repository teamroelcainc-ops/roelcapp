// src/features/pagos/services/plantillaFacturasExcel.ts
// ✅ V00484 — descargar y leer el Excel de la plantilla de facturas a pagar. La librería de Excel se
// carga al usarla (como los reportes de Pagos), no al entrar al módulo.
import { ENCABEZADOS_PLANTILLA, HOJA_PLANTILLA, leerFilasPlantilla } from './plantillaFacturas';
import type { FilaPlantilla } from './plantillaFacturas';

const INSTRUCCIONES = [
  ['Cómo llenar la plantilla'],
  [`1. En la hoja ${HOJA_PLANTILLA}, una factura por renglón: en la columna Factura, su número (por ejemplo 39352).`],
  ['2. Monto (opcional): el saldo abierto de la factura. Si lo escribes y no es igual al saldo, esa factura no se marca y la app te dice cuál es su saldo.'],
  ['3. En Pagos → Registrar pago (o Editar pago), elige el cliente o proveedor y presiona Cargar plantilla: se marcan las facturas que coinciden.'],
  ['4. Las que no se marcan aparecen en una lista con el motivo (pagada, de otra empresa, el monto no coincide…).'],
];

const nombreSeguro = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60);

export const descargarPlantillaFacturas = async (entidad: string): Promise<void> => {
  const XLSX = await import('xlsx');
  const libro = XLSX.utils.book_new();
  const hoja = XLSX.utils.aoa_to_sheet([[...ENCABEZADOS_PLANTILLA]]);
  hoja['!cols'] = [{ wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(libro, hoja, HOJA_PLANTILLA);
  const instrucciones = XLSX.utils.aoa_to_sheet(INSTRUCCIONES);
  instrucciones['!cols'] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');
  const sufijo = entidad ? ` - ${nombreSeguro(entidad)}` : '';
  XLSX.writeFile(libro, `Plantilla de facturas a pagar${sufijo}.xlsx`);
};

/** Renglones de la plantilla (hoja "Facturas" o, si no existe, la primera). Acepta .xlsx, .xls y .csv. */
export const leerPlantillaFacturas = async (archivo: File): Promise<FilaPlantilla[]> => {
  const XLSX = await import('xlsx');
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
  const nombre = libro.SheetNames.find((n) => n.trim().toLowerCase() === HOJA_PLANTILLA.toLowerCase()) ?? libro.SheetNames[0];
  const hoja = nombre ? libro.Sheets[nombre] : undefined;
  if (!hoja) return [];
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: '' });
  return leerFilasPlantilla(matriz);
};
