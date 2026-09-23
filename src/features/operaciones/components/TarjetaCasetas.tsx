// ✅ V00348: tarjeta "CASETAS DEL DÍA" para el resumen del día — muestra EN
//   VIVO el saldo (importe vigente) de Caseta AVI y Caseta Puente III desde el
//   catálogo Tipos de Gastos. Editar el importe en Catálogos lo actualiza aquí
//   al momento. Autocontenida: se monta con <TarjetaCasetas /> junto a las
//   demás tarjetas (tipo de cambio, diésel) en App.tsx.
import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './TarjetaCasetas.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';
const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const nombreMoneda = (v: unknown): string => {
  const t = String(v ?? '');
  if (t === ID_USD) return 'Dólares';
  if (t === ID_MXN) return 'Pesos';
  const n = norm(t);
  if (n.includes('dolar') || n === 'usd') return 'Dólares';
  if (n.includes('peso') || n === 'mxn') return 'Pesos';
  return t;
};
const fmtMonto = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};

interface Caseta { nombre: string; importe: unknown; moneda: string; }

export const TarjetaCasetas: React.FC = () => {
  const [avi, setAvi] = useState<Caseta | null>(null);
  const [p3, setP3] = useState<Caseta | null>(null);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'catalogo_tipos_gastos'), (snap) => {
      let a: Caseta | null = null; let p: Caseta | null = null;
      snap.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const n = norm(x.nombre_gasto);
        const c: Caseta = { nombre: String(x.nombre_gasto || ''), importe: x.importe, moneda: nombreMoneda(x.moneda) };
        if (n === 'caseta avi') a = c;
        if (n === 'caseta puente iii' || n === 'caseta puente 3') p = c;
      });
      setAvi(a); setP3(p);
    }, (e) => console.warn('Casetas del día:', e));
    return () => unsub();
  }, []);
  return (
    <div className="tcas-tarjeta" title="Saldo vigente de las casetas — se edita en Catálogos → Tipos de Gastos y aquí se actualiza al momento">
      <span className="tcas-etiqueta">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="2.2"><path d="M4 21V8l8-5 8 5v13"></path><path d="M4 11h16"></path><path d="M9 21v-6h6v6"></path></svg>
        Casetas del día
      </span>
      <div className="tcas-linea"><span className="tcas-nombre">Puente AVI</span><span className="tcas-monto">{avi ? `${fmtMonto(avi.importe)} ${avi.moneda}` : '—'}</span></div>
      <div className="tcas-linea"><span className="tcas-nombre">Puente III</span><span className="tcas-monto">{p3 ? `${fmtMonto(p3.importe)} ${p3.moneda}` : '—'}</span></div>
    </div>
  );
};
