# V00479 — Análisis de Clientes: quién crece, baja, dejó de operar o es nuevo

**Solo web.** Va encima de la V00478. Sin funciones, reglas, índices ni banderas. Trae un **permiso nuevo**: *Análisis de Clientes*.

## Qué cambia en pantalla
**Menú → Análisis de Clientes** (debajo de Estadísticas). Usa las operaciones del año, del 1 de enero a hoy, sin canceladas ni pruebas. Se puede elegir el año actual o los dos anteriores; *Actualizar* vuelve a leer.

- **Resumen:**
  - Totales: operaciones, clientes que pagan y clientes de mercancía, con cuántos hay en cada estado. Al presionar un estado se abre su lista.
  - **Qué está cambiando:** clientes con 20 o más operaciones, agrupados en *Inactivos* (con su última operación), *Bajando* y *Creciendo* (con el cambio de operaciones por semana) y *Nuevos* (desde cuándo). Hay un grupo para Cliente Paga y otro para Cliente Mercancía; *y N más* abre la lista completa.
  - **Cómo se clasifica cada cliente:** las reglas, plegadas.
- **Cliente Paga / Cliente Mercancía:**
  - buscador y filtros *Creciendo, Estable, Bajando, Inactivo, Nuevo, Ocasional*, con su conteo;
  - tabla ordenable con Cliente, Estado, Ops, % total, Cambio últ. 3 meses, Ops/sem últ. 4 sem, Día fuerte, Pausa más larga y Última;
  - al elegir un renglón, su **ficha**:
    - operaciones y % del total;
    - ops/sem por trimestre, antes, en los últimos 3 meses y en las últimas 4 semanas;
    - días con operación, % de días que opera, por día que opera y días hábiles sin operar;
    - primera y última operación;
    - importación, exportación, vacíos, Hazmat, en falso y sábados;
    - pausa más larga y días sin operar;
    - la gráfica de operaciones por mes.
- **Días y pausas:**
  - por Cliente Paga o Cliente Mercancía (por omisión, solo los de 20 o más operaciones);
  - días con operación, % de días que opera, por día que opera, días hábiles sin operar, pausa más larga y *sin operar desde hace* (en rojo desde 21 días);
  - qué días de la semana trabaja (L M M J V S D: más oscuro = más operaciones).
- **Cada nombre se puede presionar** (en el Resumen, las tablas y la ficha) y abre sus **operaciones, de la más reciente a la primera**: fecha, referencia, tipo, tráfico, estatus, el otro cliente, unidad y convenio. Las de Falso salen en ámbar.

## Cómo se clasifica cada cliente
Cada cliente recibe el primer estado que le aplica:
1. **Ocasional:** menos de 20 operaciones en el año.
2. **Inactivo:** ninguna operación en las últimas 3 semanas.
3. **Nuevo:** su primera operación del año fue en los últimos 6 meses.
4. **Creciendo:** sus operaciones por semana de los últimos 3 meses (13 semanas) son 20% o más que las de antes (desde su primera operación del año hasta hace 3 meses).
5. **Bajando:** son 20% o menos que las de antes.
6. **Estable:** el resto.

**No se pudo abrir la investigación del cliente:** el artefacto es de otra organización y el chat compartido llega vacío. Las reglas se armaron con las capturas y coinciden con sus números: −22% Bajando, −19% Estable, +9% Estable, última operación el 29 sep Inactivo y "desde 24 abr" Nuevo. Si la investigación usó otras, se ajustan en un solo lugar.

## Pasos manuales
1. **Roles y Permisos:** marca **Análisis de Clientes** (grupo General) en los roles que lo deben ver. El Admin lo ve siempre.
2. **Lecturas:** cada vez que se abre el módulo (o se presiona Actualizar) se leen las operaciones del año, unas 8,600 hoy. Mientras la sesión sigue abierta, volver al módulo no las vuelve a leer.

## Técnico
- `features/analisisClientes/services/analisisClientes.ts` (puro, + prueba):
  - `REGLAS`, `aOpAnalisis` (sin canceladas ni pruebas; nombre del catálogo; Hazmat y vacío por carga y convenio);
  - `analizarClientes` (ficha por cliente), `queEstaCambiando`, `operacionesDeCliente` (de la más reciente);
  - `ordenarFichas` y los formatos.
- `analisisClientesDatos.ts`: `leerOperacionesDelPeriodo`. Es una consulta por rango: `fechaServicioISO` con `consultasCanonicas`; si no, `fechaServicio`.
- Componentes, cada uno con su `.css` y prefijo:
  - `AnalisisClientesDashboard` (`acs-`, TanStack Query 10 min);
  - `ResumenClientes` (`acr-`), `TablaClientes` (`act-`), `DetalleCliente` (`acf-`), `DiasYPausas` (`acp-`), `OperacionesDeCliente` (`aco-`, portal) y `EstadoCliente` (`ach-`).
- Registro del módulo:
  - `App.tsx`: lazy, permiso `'Análisis de Clientes' → analisisClientes`, `ICON`, menú y render;
  - `RolesDashboard` (General), `EtiquetasDashboard` (`menu.analisis_clientes`) y `modulosNavMovil` (*Clientes*).
- Banco de pruebas (escritorio y celular), con 4,033 operaciones del año, 708 de ellas sembradas para cinco clientes:
  - **Clasificación:** C.H. Robinson Estable, ROADX Inactivo (última 7 jul), Torve Nuevo (desde 28 sep), Huizachal Creciendo (+194%) y ELI Bajando (−50%).
  - **Nombres:** presionar ROADX abre sus 53 operaciones desde el 07/07 hacia atrás, y Escape la cierra.
  - **Filtros, ficha y pestañas:** el filtro Inactivo deja solo a ROADX; la ficha de Huizachal muestra sus trimestres (0.9 / 1 / 2.5 / 3) y la gráfica por mes; Días y pausas y Cliente Mercancía cargan.
  - Sin errores de consola.
