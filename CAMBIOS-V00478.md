# V00478 — Empresas: encontrar los duplicados por nombre y unirlos desde la misma ventana

**Solo web.** Va encima de la V00477. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
**Bases de Datos → Empresas → Duplicadas.**
- **El botón dice cuántos grupos hay** (p. ej. *Duplicadas 12*). Se calculan en vivo: al unir o editar una empresa, se actualizan solos.
- **Encuentra más casos:**
  - **Mismo nombre**, aunque cambie la forma legal, los acentos o los signos. Por ejemplo: *Roelca Inc.* = *ROELCA*; *Tubería y Válvulas del Norte SA de CV* = *Tuberia y Valvulas Del Norte*; *C.H. Robinson* = *CH Robinson*.
  - **Nombre parecido:** una letra de más o de menos (dos en nombres largos), como *Like Solutions Logisticss* ≈ *Like Solutions Logistics LLC*. También las mismas palabras en otro orden, o una palabra de más (*Jesús Molero* ≈ *Jesus Levi Molero*).
  - **Mismo RFC** (sin contar el RFC genérico).
  - **Los números distintos no se juntan:** *Planta 5* / *Planta 6* son sucursales distintas.
- **La ventana tiene:**
  - un buscador y los filtros *Mismo nombre*, *Parecidos* y *Mismo RFC*, cada uno con su conteo;
  - en cada registro, su # de cliente, RFC, tipo de empresa, **cuántas operaciones tiene** y **Ver uso** (dónde aparece en la app).
- **Unir desde el grupo:** todos los registros del grupo vienen marcados; desmarca los que no son la misma empresa y presiona **Unir N registros**. Se abre el *Unir* de siempre:
  - por omisión **se conserva el que tiene más operaciones** (se puede cambiar);
  - las referencias de los demás pasan a él: operaciones, facturas, pagos, convenios, unidades de proveedor, diésel y documentos;
  - pide la misma autorización que *Borrar*.
- **En la tabla:** las empresas que tienen un posible duplicado llevan la etiqueta **Posible duplicado**. Al presionarla se abre la ventana con su grupo.

## Pasos manuales
Ninguno. Recomendado: revisar primero el filtro **Mismo nombre** (son casi siempre la misma empresa) y después **Parecidos** y **Mismo RFC** con más cuidado.

## A tomar en cuenta
- Un grupo que no es duplicado (dos empresas distintas con nombre parecido) **sigue apareciendo**: basta con no unirlo. Si estorba, se puede agregar un botón *No son la misma*.
- Corrección: al unir, el duplicado se borra por el id real del documento. Antes, en empresas migradas con un campo `id` distinto al del documento, el registro duplicado no se borraba.

## Técnico
- `features/empresas/services/duplicadosEmpresas.ts` (+ prueba):
  - `nombreComparable`, `claveNombre`, `distanciaEdicion` (con tope) y `buscarDuplicados` (bloques + unión-búsqueda; motivos `nombre` / `parecido` / `rfc`);
  - orden: mismo nombre, mismo RFC y luego parecidos.
- `EmpresasDashboard`:
  - `gruposDuplicados` y `enGrupoDuplicado` salen del catálogo en vivo. Se quitó el getDocs propio de `analizarDuplicadas`;
  - `gruposVisibles` (buscador y filtro), `fueraDeUnion` (desmarcados) y `registroListoPorId`;
  - `abrirUnirCon(ids)`: por omisión conserva el de más operaciones;
  - `deleteDoc` por `idReal`;
  - etiqueta `.ed-dup-marca` en la tabla.
- `EmpresasDashboard.css`: `.ed-dup-cuenta`, `.ed-dup-herramientas`, `.ed-dup-filtro*`, `.ed-dup-miembros`, `.ed-dup-check`, `.ed-dup-miembro-ops`, `.ed-dup-grupo-pie`, `.ed-dup-unir`, `.ed-dup-marca`.
- ESLint del archivo: 61 → 60.
- Banco de pruebas, con 2,000 empresas *Empresa N SA de CV* (ninguna sale como duplicada) más tres pares:
  - salen 3 grupos: *ROELCA · Roelca Inc.* (mismo nombre), *Alfa Transportes · Transportes Beta* (mismo RFC) y *Like Solutions Logistics LLC · Like Solutions Logisticss* (parecido);
  - el buscador y los filtros funcionan, y con un solo registro marcado no deja unir;
  - Unir conserva el que tiene 3 operaciones, borra el otro y el grupo desaparece;
  - en la tabla, *ROELCA* y *Roelca Inc.* llevan *Posible duplicado*;
  - sin errores de consola.
