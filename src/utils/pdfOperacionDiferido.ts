// src/utils/pdfOperacionDiferido.ts
// ---------------------------------------------------------------------------
// ✅ V00534 — Los PDF de una operación (Solicitud de retiro, Instrucciones, Check list, Prueba de
// entrega, Carta de instrucciones) con pdfGenerator.ts cargado AL GENERAR, no con la pantalla.
// Operaciones Activas, Completados y Cancelados lo importaban estático (~45 KB sin comprimir de
// plantillas en cada una). Mismas firmas que en pdfGenerator: quien llama solo cambia el import.
// ---------------------------------------------------------------------------
import { avisar } from '../shared/data/avisos';
import type {
  DatosCartaInstrucciones, DatosCheckList, DatosInstruccionesServicio, DatosPruebaEntrega, DatosSolicitudRetiro,
} from './pdfGenerator';

type ModuloPdf = typeof import('./pdfGenerator');

/** De dónde sale el generador (un objeto para poder sustituirlo en las pruebas). */
export const cargadorPdfOperacion = { cargar: (): Promise<ModuloPdf> => import('./pdfGenerator') };

const generarCon = (generar: (modulo: ModuloPdf) => void): void => {
  cargadorPdfOperacion.cargar()
    .then(generar)
    .catch((error: unknown) => {
      console.error('[PDF] No se pudo cargar el generador de documentos:', error);
      avisar({ tipo: 'alerta', titulo: 'No se pudo generar el PDF', texto: 'Revisa tu conexión e intenta de nuevo.' });
    });
};

export const generarSolicitudRetiroPDF = (datos: DatosSolicitudRetiro): void =>
  generarCon((pdf) => pdf.generarSolicitudRetiroPDF(datos));
export const generarInstruccionesServicioPDF = (datos: DatosInstruccionesServicio): void =>
  generarCon((pdf) => pdf.generarInstruccionesServicioPDF(datos));
export const generarCheckListPDF = (datos: DatosCheckList): void =>
  generarCon((pdf) => pdf.generarCheckListPDF(datos));
export const generarPruebaEntregaPDF = (datos: DatosPruebaEntrega): void =>
  generarCon((pdf) => pdf.generarPruebaEntregaPDF(datos));
export const generarCartaInstruccionesPDF = (datos: DatosCartaInstrucciones): void =>
  generarCon((pdf) => pdf.generarCartaInstruccionesPDF(datos));
