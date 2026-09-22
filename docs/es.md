# jev-helper en Pi

Paquete comunitario no oficial, MIT. Usa el `mcpScript` del **pi-mcp-adapter instalado por separado** para decisiones acotadas con Jev. No es un producto oficial de Pi, Gentle AI ni TypeSafe. Instalarlo no activa Jev ni envía datos.

**Para entradas chicas o ya vistas, preferí razonamiento directo o proyección determinista.** En las dos comparaciones medidas, el helper consumió más tokens reportados y tardó más: fuentes públicas **7094 → 19206 tokens, 35,401 → 52,671 s**; evidencia sintética insuficiente **2611 → 16228 tokens, 14,983 → 39,475 s**. Hubo una observación por variante, sin ganancia de precisión o calibración demostrada; el costo monetario real no está disponible. Usalo solo como señal estructurada opcional cuando justifique la sobrecarga.

## Instalación y activación explícita

Instalá la versión fijada después de revisar los recursos existentes:

```sh
pi list
pi config
# Solo si el adaptador todavía NO está instalado:
pi install npm:pi-mcp-adapter@2.36.0
pi install git:github.com/IrrealV/jev-helper@v0.1.0
```

La prueba de instalación anónima del tag público y los resultados de CI se registran en las [notas de la versión](https://github.com/IrrealV/jev-helper/releases/tag/v0.1.0) y [Actions](https://github.com/IrrealV/jev-helper/actions) después de publicar. La validación local no reemplaza esos registros.

Pi instala globalmente por defecto. Agregá `-l` a cada instalación si querés alcance de proyecto. No instales un segundo adaptador para sortear una restricción de herramientas.

Cargá la clave únicamente en el prompt nativo de terminal del adaptador:

```sh
npx --yes --package pi-mcp-adapter@2.36.0 pi-mcp-adapter key set typesafe
```

También podés ejecutar `node /ruta/al/adaptador/cli.js key set typesafe`. Nunca pegues la clave en chat, argumentos, specs ni archivos del repositorio. La clave **no habilita** `scriptEvaluation`; `/mcp jev setup` configura búsqueda semántica, no evaluación de scripts.

Recargá Pi y elegí explícitamente el alcance de configuración:

```text
/jev-doctor
/jev-setup project
```

Aceptá la confirmación solo si querés habilitar evaluación externa. Los valores nuevos permiten únicamente estado sintético, con lista de fuentes vacía. Se conservan las opciones y límites previos; si el objeto Jev existente no declara `semanticSearch`, mantiene el comportamiento implícito del adaptador según la credencial. Para fuentes MCP reales ya habilitadas, usá `/jev-setup project --sources docs,github` con sus nombres reales; `--sources []` selecciona estado sintético. El helper no configura servidores.

Después del setup, **recargá** y abrí una **sesión nueva** para descubrir la skill. Doctor separa configuración en disco de herramientas activas; no certifica claves ni configuración interna del adaptador y no hace llamadas de red.

## Uso

```text
/skill:jev-decisions
/jev-run /ruta/al/paquete/examples/evaluate.json
```

`/jev-run` lee un único JSON UTF-8 de hasta 32768 bytes, genera código y le pide al modelo actual que lo ejecute mediante `mcpScript`. No invoca otra herramienta directamente. Revisá el contenido: el estado llegará al modelo principal y, si se ejecuta con permiso, a Jev.

El archivo `examples/prioritize.json` es una **plantilla para adaptar**, no una fuente funcional preconfigurada. `examples/grep-prioritize.mjs` es una receta opcional de texto crudo para pegar como `code` de `mcpScript`, no como argumento de `/jev-run`. Se verificaron tanto la ejecución del componente como su uso por el modelo en una sesión SDK nueva con llamadas normales a herramientas. El sandbox no tiene acceso directo al filesystem local ni a herramientas nativas de Pi.

Noul bajo significa **no**, no baja confianza. Choice elige una opción e incluye `none`/`insufficient`. Score usa 2–10 niveles ordenados y conserva la distribución. No inventes umbrales calibrados. Las preguntas independientes comparten estado, no respuestas. Para una lectura barata y reversible, consumí el resultado directamente; para conclusiones importantes, conservá evidencia, pruebas y permisos. No lo uses para matemática trivial ni para decidir recursivamente si conviene llamarlo.

## Deshacer y quitar

```text
/jev-undo project
```

Elegí el mismo alcance de configuración, confirmá y recargá. Undo restaura solo el bloque Jev propio si no cambió; conserva otras ediciones y rechaza conflictos. El sidecar contiene únicamente el bloque Jev anterior y el esperado, nunca servidores ni credenciales, y queda disponible para recuperación.

Luego quitá el paquete del mismo alcance de instalación:

```sh
pi remove -l git:github.com/IrrealV/jev-helper@v0.1.0
# Omití -l si la instalación fue global.
```

Quitar el paquete no revierte configuración ni borra el adaptador o su clave. Para actualizar un tag fijado, instalá explícitamente un nuevo tag publicado y revisado, con el mismo alcance; recargá y abrí sesión nueva. No fuerces ni muevas tags publicados.

CLI: `node bin/jev-helper.mjs setup project --enable`, `doctor`, `undo project`, `script spec.json`. Si Node no encuentra el SDK opcional de Pi, pasá `--adapter-root /ruta/al/adaptador`. Si Pi usa `--mcp-config`, pasá el mismo archivo al CLI. El modo exclusivo del adaptador se respeta; no se adivinan configuraciones programáticas.

## Evidencia y límites

En Linux, Pi 0.86.1, adaptador 2.36.0 y Node 26.8.2: **125 tests offline**, dos extensiones empaquetadas sin errores, ambas skills descubiertas, doctor/setup con **confirmación UI simulada**, y setup/idempotencia/undo/reaplicación por CLI. Sesiones reales nuevas mediante `session.prompt` y `tool_call` verificaron `/jev-run`, lectura automática de la skill y uso de la receta; no fueron llamadas directas a `AgentTool.execute`.

La comparación de fuentes usó los mismos seis fragmentos acotados y diez referencias en ambas variantes, no un volcado de texto crudo como baseline. Las dos lecturas elegidas eran relevantes; la confianza del helper fue 0,29 y no había una única mejor lectura validada. Con [insufficient.json](../examples/insufficient.json), ambos rechazaron una causa sin evidencia: el helper produjo Noul 0,02, Choice `insufficient` (probabilidad 1), Score 1; el baseline usó etiquetas cualitativas, no un esquema de salida idéntico.

El total del helper incluye instrucciones, lectura de skill/ejemplos y uso del modelo principal más Jev. Los contadores de caché se conservaron; los 71 tokens de razonamiento del baseline sintético ya están incluidos en su salida y no se suman otra vez. Los tokenizadores difieren. N=1 por variante, baseline primero, caché del proveedor sin forzar: no se puede generalizar ahorro, calidad ni calibración. Las estimaciones del catálogo SDK son solo del modelo principal y no son cargos reales ni contabilidad de suscripción; el costo combinado real sigue sin estar disponible.

El [agregado público](validation-v0.1.0.json) conserva los números originales sin credenciales, rutas personales ni transcripciones. Se usaron **7/8 evaluaciones Jev**, con cero reintentos configurados; la restante queda reservada para un smoke público final necesario. Los tamaños mínimos 1391/7494 son **bytes UTF-8**, no tokens. La medición precede estos cambios finales de documentación/comentario; el cuerpo ejecutable de la receta no cambió.

No hay caché v1 ni telemetría propia. El estado no es inmune a inyección. Las fuentes son procedencia, no filtro de contenido. Revisá las políticas de retención de cada proveedor.

[Ejemplos](examples.md) · [Privacidad](privacy.md) · [Compatibilidad y recuperación](compatibility.md) · [Mediciones](measurement.md)
