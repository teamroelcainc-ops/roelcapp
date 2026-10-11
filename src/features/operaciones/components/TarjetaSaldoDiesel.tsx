// src/features/operaciones/components/TarjetaSaldoDiesel.tsx
// ✅ V00411: tarjeta del SALDO DE DIESEL en el resumen de Operaciones Activas.
//   Misma cuenta que Referencias del Diesel → Saldos: por proveedor, saldos
//   agregados − Total Cargado de sus referencias desde su primer saldo.
// ✅ V00441 (Fase 5.6): con la bandera `saldosCorrientes` ya no escucha las 3,000
//   referencias: lee el cargado POR DÍA que mantiene el servidor en
//   saldos_corrientes (un documento por proveedor). Misma cuenta.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useModuloEscuchando } from '../../../utils/moduloVivoContexto';
import { useFlags } from '../../../shared/data/flags';
import { COL_SALDOS_CORRIENTES, cuentasDiesel, cuentasDieselDesdeReferencias } from '../../../shared/dominio/saldosCorrientes';
import type { SaldoCorrienteDiesel } from '../../../shared/dominio/saldosCorrientes';

type Fila = Record<string, unknown>;
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const TarjetaSaldoDiesel: React.FC = () => {
  const [saldos, setSaldos] = useState<Fila[]>([]);
  const [refs, setRefs] = useState<Fila[]>([]);
  const [corrientes, setCorrientes] = useState<SaldoCorrienteDiesel[]>([]);
  const { saldosCorrientes } = useFlags();
  // ✅ V00438 (Fase 2.7): escucha solo con Operaciones visible; oculta conserva las cifras.
  //   Sin ventana de fechas: el saldo restante descuenta TODAS las cargas desde el 1er
  //   saldo de cada proveedor y "Cargas hoy" sale de esas mismas referencias; acotar
  //   cambiaría las cifras. Saldo corrido en un documento → Fase 5.6.
  const moduloVisible = useModuloEscuchando(); // ✅ V00446: sigue escuchando unos minutos oculto
  useEffect(() => {
    if (!moduloVisible) return;
    const u1 = onSnapshot(collection(db, 'saldos_diesel'), (s) => setSaldos(s.docs.map((d) => ({ id: d.id, ...(d.data() as Fila) }))), () => setSaldos([]));
    const u2 = saldosCorrientes
      ? onSnapshot(query(collection(db, COL_SALDOS_CORRIENTES), where('tipo', '==', 'diesel')), (s) => setCorrientes(s.docs.map((d) => d.data() as SaldoCorrienteDiesel)), () => setCorrientes([]))
      : onSnapshot(query(collection(db, 'referencias_diesel'), orderBy('createdAt', 'desc'), limit(3000)), (s) => setRefs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Fila) }))), () => setRefs([]));
    return () => { u1(); u2(); };
  }, [moduloVisible, saldosCorrientes]);

  const hoy = hoyISO();
  const cuentas = useMemo(
    () => (saldosCorrientes ? cuentasDiesel(saldos, corrientes, hoy) : cuentasDieselDesdeReferencias(saldos, refs, hoy)),
    [saldosCorrientes, saldos, corrientes, refs, hoy],
  );

  const total = cuentas.reduce((a, c) => a + c.restante, 0);
  const monedas = Array.from(new Set(cuentas.map((c) => c.moneda).filter(Boolean)));
  const cargasHoy = cuentas.reduce((a, c) => a + c.cargasHoy, 0);
  const cargadoHoy = cuentas.reduce((a, c) => a + c.cargadoHoy, 0);

  return (
    <div className="rd-card rd-card--naranja" title="Saldo de diesel (Referencias del Diesel → Saldos): saldos agregados menos el total cargado por día">
      <div className="rd-card__head">
        <span className="rd-card__label">Saldo Diesel</span>
        {monedas.length === 1 && <span className="rd-card__chip">{monedas[0] === 'Dólares' ? 'USD' : monedas[0] === 'Pesos' ? 'MXN' : monedas[0]}</span>}
      </div>
      <span className={`rd-card__value${total < 0 ? ' rd-card__value--neg' : ''}`}>{cuentas.length ? fmt(total) : '—'}</span>
      <span className="rd-card__sub">{cuentas.length ? 'Saldo restante' : 'Sin saldos registrados'}</span>
      <div className="rd-filas">
        {cuentas.slice(0, 3).map((c) => (
          <div key={c.clave} className="rd-filas__f" title={c.nombre}>
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
