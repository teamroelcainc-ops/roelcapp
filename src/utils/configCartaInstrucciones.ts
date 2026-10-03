// src/utils/configCartaInstrucciones.ts
// ✅ V00421: CUÁNDO se muestra el botón "Carta Instrucciones" en la ficha de la operación.
//   config_documentos/cartaInstrucciones = { modo: 'todos' | 'filtro', tipos: [ids], destinos: [ids] }
//   · todos  → en todas las operaciones (Logística Cruces, Transfer, Fletes, Rentas…)
//   · filtro → solo si el TIPO de operación está en `tipos` O el DESTINO (bodega) está en `destinos`
import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface ConfigCarta { modo: 'todos' | 'filtro'; tipos: string[]; destinos: string[] }
export const CONFIG_CARTA_DEFECTO: ConfigCarta = { modo: 'todos', tipos: [], destinos: [] };
const ref = () => doc(db, 'config_documentos', 'cartaInstrucciones');

export const useConfigCarta = (): ConfigCarta => {
  const [cfg, setCfg] = useState<ConfigCarta>(CONFIG_CARTA_DEFECTO);
  useEffect(() => onSnapshot(ref(), (s) => {
    const d = (s.exists() ? s.data() : {}) as Partial<ConfigCarta>;
    setCfg({ modo: d.modo === 'filtro' ? 'filtro' : 'todos', tipos: Array.isArray(d.tipos) ? d.tipos.map(String) : [], destinos: Array.isArray(d.destinos) ? d.destinos.map(String) : [] });
  }, () => setCfg(CONFIG_CARTA_DEFECTO)), []);
  return cfg;
};

export const guardarConfigCarta = (cfg: ConfigCarta) => setDoc(ref(), { ...cfg, actualizadoEn: new Date().toISOString() });

export const mostrarCartaPara = (op: Record<string, unknown> | null | undefined, cfg: ConfigCarta): boolean => {
  if (!op) return false;
  if (cfg.modo !== 'filtro') return true;
  const tipo = String(op.tipoOperacionId ?? op.tipoOperacion ?? '').trim();
  const destino = String(op.destino ?? '').trim();
  return (!!tipo && cfg.tipos.includes(tipo)) || (!!destino && cfg.destinos.includes(destino));
};
