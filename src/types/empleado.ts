// src/types/empleado.ts

export interface Employee {
  id?: string;
  employeeId: string; // Formato Emp-001
  activo: boolean;
  
  // Datos Personales
  foto?: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string;
  alias: string;
  rfc: string;
  birthDate: string;
  mapsLink: string;
  addressId: string;
  addressLabel: string;
  personalPhone: string;
  personalEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;

  // Alta de la empresa
  cargoId: string;
  cargoNombre: string;
  departamentoId: string;
  departamentoNombre: string;
  operacionesIds: string[]; // MultiSelect
  empresaId: string;
  empresaNombre: string;
  fechaIngreso: string;
  fechaAltaIMSS: string;
  salarioDiario: number;
  descuentoIMSS: number;
  descuentoInfonavit: number;

  // Operador
  gastosAsignados: number;

  // Herramienta de trabajo
  telefonoAsignado: string;
}