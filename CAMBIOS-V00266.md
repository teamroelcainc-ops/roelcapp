# V00266 — MOTOR RELACIONAL (Fase 1): cascadas automáticas en Cloud Functions

## Archivos que cambian (respetar rutas)
- `functions/src/relacional.ts` **(NUEVO)** — el motor relacional
- `functions/src/index.ts` — exporta el módulo nuevo
- `src/features/catalogos/components/CatalogosDashboard.tsx` — botón 🧪
- `src/config/version.ts` y `public/version.json` — bump a V00266.

## Qué es esto
Firestore no tiene llaves foráneas ni cascadas. Este módulo las EMULA en el
SERVIDOR (Cloud Functions v2, mismas que tu crearOperacion), como los
ON UPDATE CASCADE de SQL. A partir de aquí la app se comporta relacional:
los cambios se propagan SOLOS, al instante, sin botones y sin depender del
navegador de nadie.

## Las 4 piezas
1. **empresaActualizada** — renombras una empresa en Empresas y el nombre se
   propaga automáticamente a facturas (clientes y proveedores), operaciones
   (cliente y proveedor) y ambos tarifarios. La MONEDA de emisión de las
   facturas NO se toca (regla V00265).
2. **operacionEscrita** — cada operación guardada (nueva, editada o
   importada) queda íntegra AL INSTANTE: su C/V, Aduana y Expo/Impo se
   derivan del convenio contra los catálogos (regla "el convenio manda").
   Es el botón "⇊ Normalizar" corriendo solo, documento por documento.
3. **catalogoCVRenombrado / catalogoAduanaRenombrada** — renombras un rubro
   del catálogo y todas las operaciones que lo usaban se actualizan solas.
4. **verificarIntegridad** — botón nuevo "🧪 Verificar integridad" en
   Catálogos (Tarifas de Referencia y C/V): revisa TODA la base en el
   servidor y reporta referencias rotas — operaciones con cliente/proveedor
   inexistente, C/V o aduanas fuera de catálogo, facturas con cliente
   inexistente o con operaciones borradas — con ejemplos. Es el equivalente
   casero de los constraints de SQL: no previene, pero detecta al momento.

Anti-bucles: cada trigger escribe SOLO si el valor difiere; su propia
escritura ya no difiere → la cadena se detiene sola. Los botones manuales
(⇊, ⇄, ⟳) siguen como respaldo masivo.

## PASOS AL INSTALAR (importante)
1. Copia los archivos y publica la app como siempre (V00266).
2. Despliega las funciones: en la carpeta del proyecto corre
   `firebase deploy --only functions`
   (igual que cuando desplegamos crearOperacion; compila sola).
3. Prueba: renombra una empresa de prueba en Empresas → abre una factura
   suya → el nombre ya cambió solo. Guarda una operación → su C/V queda el
   del convenio sin presionar nada.
4. Presiona "🧪 Verificar integridad" para ver el estado real de la base.

## Costo
Los triggers corren solo cuando algo cambia (centavos al mes con tu
volumen). El verificador lee la base completa al presionarlo — úsalo como
chequeo, no cada cinco minutos.

## Fases siguientes (cuando digas)
- Fase 2: cascada COMPLETA de descripciones server-side (tarifas →
  detalles → tarifarios → operaciones) para retirar la del navegador.
- Fase 3: "el ID es la verdad" en formularios restantes + verificador
  programado cada noche con aviso.

## Verificación
- `functions`: `tsc` compila limpio (lib/ generado).
- App: `tsc --noEmit` 0 errores, ESLint 113 idéntico, `npm run build` OK.
