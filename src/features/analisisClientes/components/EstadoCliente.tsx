// src/features/analisisClientes/components/EstadoCliente.tsx
// ✅ V00479 — etiqueta del estado de un cliente (Creciendo, Estable, Bajando, Inactivo, Nuevo, Ocasional).
import { ETIQUETA_ESTADO } from '../services/analisisClientes';
import type { EstadoCliente as Estado } from '../services/analisisClientes';
import './EstadoCliente.css';

export default function EstadoCliente({ estado }: { estado: Estado }) {
  return <span className={`ach-chip ach-chip--${estado}`}>{ETIQUETA_ESTADO[estado]}</span>;
}
