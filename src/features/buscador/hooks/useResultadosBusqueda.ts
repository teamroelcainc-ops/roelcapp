// src/features/buscador/hooks/useResultadosBusqueda.ts
// ---------------------------------------------------------------------------
// ✅ V00502 — BUSCADOR GLOBAL: los resultados de toda la app para una búsqueda.
//   · Empresas, convenios, empleados, unidades y remolques: los catálogos compartidos (en memoria).
//   · Facturas y pagos: los listeners compartidos con Facturación y Pagos (misma clave = mismo
//     listener; si ya están abiertos no cuesta nada).
//   · Operaciones: consultas por prefijo (buscarOperaciones), con espera de 350 ms al escribir.
//   Todo se pide solo mientras la lista está abierta, y solo lo que el usuario puede ver
//   (permisos del rol). Lo que aún no llega se marca como "cargando" en su grupo.
// ---------------------------------------------------------------------------
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useCatalogos } from '../../../shared/data/catalogos';
import { idReal, useColeccionViva } from '../../../shared/data/coleccionesVivas';
import { consultaFacturasPagables } from '../../pagos/hooks/useFacturasPagables';
import { consultaPagos } from '../../pagos/services/consultaPagos';
import { useClavesPermitidas } from '../../../utils/permisos';
import { palabras } from '../services/coincidencias';
import { buscarOperaciones, MIN_LETRAS_OPERACIONES } from '../services/buscarOperaciones';
import {
  GRUPOS, MAX_POR_GRUPO, resultadosConvenios, resultadosEmpleados, resultadosEmpresas, resultadosFacturas,
  resultadosOperaciones, resultadosPagos, resultadosRemolques, resultadosUnidades,
} from '../services/resultados';
import type { Doc, GrupoResultado, ResultadoBusqueda } from '../services/resultados';

export interface GrupoBusqueda {
  grupo: GrupoResultado;
  titulo: string;
  resultados: ResultadoBusqueda[];
  cargando: boolean;
  error: string | null;
}

const ESPERA_OPERACIONES_MS = 350;

interface EstadoOperaciones { consulta: string; docs: Doc[]; error: string | null }

export function useResultadosBusqueda(consulta: string, abierto: boolean): { grupos: GrupoBusqueda[]; buscando: boolean } {
  const permitidas = useClavesPermitidas();
  const q = palabras(consulta).join(' ');
  const qDiferida = useDeferredValue(q);

  // ── Catálogos (en memoria) ──
  const cat = useCatalogos({
    empresas: 'empresas', empleados: 'empleados', unidades: 'unidades', unidadesProv: 'unidades_proveedor', remolques: 'remolques',
    convCli: 'convenios_clientes', convCliDet: 'convenios_clientes_detalles', convProv: 'convenios_proveedores', convProvDet: 'convenios_proveedores_detalles',
    status: 'catalogo_status_servicio',
  }, { activo: abierto });
  const nombresStatus = useMemo(() => new Map(cat.datos.status.flatMap((s) => {
    const n = String(s.nombre ?? '').trim();
    return n ? [[idReal(s), n] as const, [String(s.id), n] as const] : [];
  })), [cat.datos.status]);

  // ── Facturas y pagos (listeners compartidos con Facturación y Pagos) ──
  const fc = consultaFacturasPagables('cliente', false);
  const fp = consultaFacturasPagables('proveedor', false);
  const facCli = useColeccionViva(permitidas.has('facturacionClientes') ? fc.clave : null, fc.crear, { activo: abierto, soloVisible: false });
  const facProv = useColeccionViva(permitidas.has('facturacionProveedores') ? fp.clave : null, fp.crear, { activo: abierto, soloVisible: false });
  const pc = consultaPagos('cliente');
  const pp = consultaPagos('proveedor');
  const pm = consultaPagos('mtto');
  const verPagos = permitidas.has('pagos');
  const pagCli = useColeccionViva(verPagos ? pc.clave : null, pc.crear, { activo: abierto, soloVisible: false });
  const pagProv = useColeccionViva(verPagos ? pp.clave : null, pp.crear, { activo: abierto, soloVisible: false });
  const pagMtto = useColeccionViva(verPagos ? pm.clave : null, pm.crear, { activo: abierto, soloVisible: false });

  // ── Operaciones (Firestore por prefijo, con espera al escribir) ──
  const verOperaciones = permitidas.has('operaciones') || permitidas.has('serviciosCompletados') || permitidas.has('serviciosCancelados');
  const [ops, setOps] = useState<EstadoOperaciones>({ consulta: '', docs: [], error: null });
  // El texto como se escribió (las variantes de mayúsculas salen de él); el resultado se guarda con la
  // búsqueda normalizada, que es con la que se compara al pintar.
  const textoOps = abierto && verOperaciones && q.length >= MIN_LETRAS_OPERACIONES ? consulta.trim() : '';
  useEffect(() => {
    if (!textoOps) return undefined;
    let vigente = true;
    const clave = palabras(textoOps).join(' ');
    const timer = setTimeout(() => {
      buscarOperaciones(textoOps)
        .then((docs) => { if (vigente) setOps({ consulta: clave, docs, error: null }); })
        .catch((e: unknown) => { if (vigente) setOps({ consulta: clave, docs: [], error: String((e as Error)?.message || e) }); });
    }, ESPERA_OPERACIONES_MS);
    return () => { vigente = false; clearTimeout(timer); };
  }, [textoOps]);

  const grupos = useMemo<GrupoBusqueda[]>(() => {
    if (!qDiferida) return [];
    const d = cat.datos as unknown as Record<string, Doc[]>;
    const listoCat = cat.listo;
    const porGrupo: Record<GrupoResultado, { resultados: ResultadoBusqueda[]; cargando: boolean; error: string | null }> = {
      operaciones: {
        resultados: ops.consulta === qDiferida ? resultadosOperaciones(ops.docs, qDiferida, nombresStatus) : [],
        cargando: qDiferida.length >= MIN_LETRAS_OPERACIONES && ops.consulta !== qDiferida,
        error: ops.consulta === qDiferida ? ops.error : null,
      },
      facturas: {
        resultados: [
          ...resultadosFacturas(facCli.datos as Doc[], 'cliente', qDiferida),
          ...resultadosFacturas(facProv.datos as Doc[], 'proveedor', qDiferida),
        ].sort((a, b) => b.puntaje - a.puntaje).slice(0, MAX_POR_GRUPO),
        cargando: (permitidas.has('facturacionClientes') && !facCli.listo) || (permitidas.has('facturacionProveedores') && !facProv.listo),
        error: facCli.error || facProv.error,
      },
      pagos: {
        resultados: [
          ...resultadosPagos(pagCli.datos as Doc[], 'cliente', qDiferida),
          ...resultadosPagos(pagProv.datos as Doc[], 'proveedor', qDiferida),
          ...resultadosPagos(pagMtto.datos as Doc[], 'mtto', qDiferida),
        ].sort((a, b) => b.puntaje - a.puntaje).slice(0, MAX_POR_GRUPO),
        cargando: verPagos && !(pagCli.listo && pagProv.listo && pagMtto.listo),
        error: pagCli.error || pagProv.error || pagMtto.error,
      },
      empresas: { resultados: resultadosEmpresas(d.empresas, qDiferida), cargando: !listoCat, error: null },
      convenios: {
        resultados: [
          ...(permitidas.has('detallesConvenioClientes') ? resultadosConvenios(d.convCliDet, d.convCli, 'clientes', qDiferida) : []),
          ...(permitidas.has('detallesConvenioProveedores') ? resultadosConvenios(d.convProvDet, d.convProv, 'proveedores', qDiferida) : []),
        ].sort((a, b) => b.puntaje - a.puntaje).slice(0, MAX_POR_GRUPO),
        cargando: !listoCat,
        error: null,
      },
      empleados: { resultados: resultadosEmpleados(d.empleados, qDiferida), cargando: !listoCat, error: null },
      unidades: {
        resultados: resultadosUnidades(permitidas.has('unidades') ? d.unidades : [], permitidas.has('unidadesProveedor') ? d.unidadesProv : [], qDiferida),
        cargando: !listoCat,
        error: null,
      },
      remolques: { resultados: resultadosRemolques(d.remolques, qDiferida), cargando: !listoCat, error: null },
    };
    return GRUPOS
      .map(({ grupo, titulo }) => ({
        grupo,
        titulo,
        ...porGrupo[grupo],
        // Solo lo que el rol puede abrir.
        resultados: porGrupo[grupo].resultados.filter((r) => permitidas.has(r.destino.modulo)),
      }))
      .filter((g) => g.resultados.length > 0 || g.cargando || g.error);
  }, [qDiferida, cat.datos, cat.listo, ops, nombresStatus, facCli, facProv, pagCli, pagProv, pagMtto, permitidas, verPagos]);

  return { grupos, buscando: q !== qDiferida };
}
