// src/features/unidades/types/unidad.ts
export interface UnidadRecord {
  id?: string;
  activo: boolean;
  propietarioUnidad: string;
  tipoUnidadId: string;
  tipoUnidadNombre: string;
  unidad: string;
  color: string;
  placas: string;
  serie: string;
  marca: string;
  modelo: string;
  /** ✅ Kilometraje con el que la unidad entra a la flota. */
  kilometrajeInicial?: number;
  clase: string;
  combustible: 'Gasolina' | 'Diesel' | '';
  pesoVehicular: number;
  ejes: number;
  llantas: number;
  toneladas: number;
  alto: number;
  ancho: number;
  largo: number;
  ejeDireccional: number;
  ejeMotriz: number;
  tagAvc: string;
  expedicionHazmat: string;
  tanqueUno: number;
  tanqueDos: number;
  porcentajeRecarga: number;
}