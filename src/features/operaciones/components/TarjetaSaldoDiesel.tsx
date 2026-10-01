// src/features/operaciones/components/TarjetaSaldoDiesel.tsx
// ✅ V00411: tarjeta del SALDO DE DIESEL en el resumen de Operaciones Activas.
//   Misma cuenta que Referencias del Diesel → Saldos: por proveedor, saldos
//   agregados − Total Cargado de sus referencias desde su primer saldo.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../../config/firebase';

type Fila = Record<string, unknown>;
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cargado = (r: Fila) => Number(r.totalCargado) || ((Number(r.galonesCargados) || 0) * (Number(r.costoDiesel) || 0));

export const TarjetaSaldoDiesel: React.FC = () => {
  const [saldos, setSaldos] = useState<Fila[]>([]);
  const [refs, setRefs] = useState<Fila[]>([]);
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'saldos_diesel'), (s) => setSaldos(s.docs.map((d) => ({ id: d.id, ...(d.data() as Fila) }))), () => setSaldos([]));
    const u2 = onSnapshot(query(collection(db, 'referencias_diesel'), orderBy('createdAt', 'desc'), limit(3000)), (s) => setRefs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Fila) }))), () => setRefs([]));
    return () => { u1(); u2(); };
  }, []);

  const hoy = hoyISO();
  const cuentas = useMemo(() => {
    const porProv = new Map<string, Fila[]>();
    saldos.forEach((s) => { const k = String(s.proveedorId || s.proveedorNombre || ''); porProv.set(k, [...(porProv.get(k) || []), s]); });
    return Array.from(porProv.entries()).map(([k, lista]) => {
      const primera = lista.map((s) => String(s.fecha || '')).sort()[0] || '';
      const nombre = String(lista[0].proveedorNombre || k);
      const mias = refs.filter((r) => (String(r.proveedorId || r.proveedor || '') === k || String(r.proveedorNombre || '').trim().toLowerCase() === nombre.trim().toLowerCase()) && cargado(r) > 0 && (!primera || String(r.fecha || '') >= primera));
      const agregado = lista.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
      const consumido = mias.reduce((a, r) => a + cargado(r), 0);
      const hoyRefs = mias.filter((r) => String(r.fecha || '') === hoy);
      return { nombre, moneda: String(lista[0].moneda || ''), restante: agregado - consumido, cargasHoy: hoyRefs.length, cargadoHoy: hoyRefs.reduce((a, r) => a + cargado(r), 0) };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [saldos, refs, hoy]);

  const total = cuentas.reduce((a, c) => a + c.restante, 0);
  const monedas = Array.from(new Set(cuentas.map((c) => c.moneda).filter(Boolean)));
  const cargasHoy = cuentas.reduce((a, c) => a + c.cargasHoy, 0);
  const cargadoHoy = cuentas.reduce((a, c) => a + c.cargadoHoy, 0);

  return (
    <div className="rd-card rd-card--naranja" title="Saldo de diesel por proveedor (Referencias del Diesel → Saldos): saldos agregados menos lo cargado en sus referencias">
      <div className="rd-card__head">
        <span className="rd-card__label">Saldo Diesel</span>
        {monedas.length === 1 && <span className="rd-card__chip">{monedas[0] === 'Dólares' ? 'USD' : monedas[0] === 'Pesos' ? 'MXN' : monedas[0]}</span>}
      </div>
      <span className={`rd-card__value${total < 0 ? ' rd-card__value--neg' : ''}`}>{cuentas.length ? fmt(total) : '—'}</span>
      <span className="rd-card__sub">{cuentas.length ? 'Saldo restante' : 'Sin saldos registrados'}</span>
      <div className="rd-filas">
        {cuentas.slice(0, 3).map((c) => (
          <div key={c.nombre} className="rd-filas__f" title={c.nombre}>
            <span className="rd-filas__et">{c.nombre}</span>
            <span className={`rd-filas__v${c.restante < 0 ? ' rd-filas__v--neg' : ''}`}>{fmt(c.restante)}</span>
          </div>
        ))}
        {cuentas.length > 3 && <div className="rd-filas__f"><span className="rd-filas__et">+ {cuentas.length - 3} proveedor(es)</span><span /></div>}
        <div className="rd-filas__f rd-filas__f--sep">
          <span className="rd-filas__et">Cargas hoy · {cargasHoy}</span>
          <span className="rd-filas__v rd-filas__v--cargo">−{fmt(cargadoHoy)}</span>
        </div>
      </div>
    </div>
  );
};

export default TarjetaSaldoDiesel;
