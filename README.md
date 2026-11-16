# TP4 · Asincronismo e integración con Node.js y TypeScript

Lista compartida de productos para elegir un regalo grupal. Los participantes
proponen productos del catálogo externo [DummyJSON](https://dummyjson.com),
votan y ven los cambios en vivo por **WebSocket**. Una pantalla separada muestra
el ranking actualizado por **Server-Sent Events (SSE)**. No hay base de datos:
todo vive en memoria mientras el servidor está en ejecución.

Proyecto nuevo e independiente del TP1–TP3 (Java).

---

## 1. Instalación y ejecución

Requiere **Node.js LTS** (≥ 20; probado con Node 24).

```bash
cd tp4-realtime
npm install
cp .env.example .env        # opcional: ajustar configuración

# Desarrollo (recarga automática):
npm run dev

# O compilando con tsc:
npm run build
npm start
```

Luego:

- Participantes: <http://localhost:3000/>
- Pantalla compartida: <http://localhost:3000/screen>
- Pruebas: `npm test`
- Verificación de tipos: `npm run typecheck`

Un único puerto sirve las páginas, el WebSocket de participantes (`/ws`) y el
flujo SSE de la pantalla (`/events`). Para probar, abrí varias pestañas o
navegadores apuntando a la misma dirección.

### Configuración (sin tocar código)

Variables de entorno (archivo `.env`, cargado con `dotenv`):

| Variable | Default | Significado |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor. |
| `CATALOG_URL` | `https://dummyjson.com/products` | Base del catálogo; se consulta `${CATALOG_URL}/${id}`. |
| `CATALOG_TIMEOUT_MS` | `5000` | Tiempo máximo por consulta al catálogo. |
| `CATALOG_DELAY_MS` | `0` | Si es > 0, se agrega `?delay=<ms>` para simular catálogo lento. |

**Simular catálogo lento:** `CATALOG_DELAY_MS=3000 npm run dev` hace que cada
producto tarde ~3 s. Para forzar un **timeout**, usá un delay mayor al timeout,
por ejemplo `CATALOG_DELAY_MS=7000` con `CATALOG_TIMEOUT_MS=5000`.

---

## 2. Arquitectura

```
Navegador participante  --WebSocket (/ws)-->  ┌──────────────────────┐
Navegador participante  --WebSocket (/ws)-->  │  Servidor Node + TS  │
                                              │  SharedList (memoria)│
Navegador pantalla      --EventSource (/events)<-┤  HTTP estático       │
                                              └──────────┬───────────┘
                                                         │ fetch + AbortController (paralelo)
                                                         ▼
                                                  DummyJSON /
```

- El estado se guarda en `SharedList` (`src/store.ts`). Cada método es
  **sincrónico**, por lo que es atómico frente al event loop de Node: dos votos
  o dos propuestas simultáneas no se intercalan.
- Las consultas al catálogo de una propuesta se lanzan **en paralelo** con
  `Promise.all`. La espera es asíncrona, así que otros participantes siguen
  votando y recibiendo actualizaciones mientras tanto.
- Los cambios se aplican en un bloque sincrónico *después* de que todas las
  consultas terminan; se vuelve a verificar la existencia del producto en ese
  momento para evitar duplicados por carreras.
- El servidor **nunca confía en datos de producto enviados por el cliente**:
  título, precio e imagen se obtienen siempre del catálogo.

---

## 3. Contrato de mensajes

Todos los mensajes son **JSON con un campo `type`**. Están tipados en
`src/types.ts` y validados en `src/validation.ts`.

### 3.1 Participante → Servidor (WebSocket)

| `type` | Campos | Cuándo se envía |
|---|---|---|
| `join` | `name: string` | Al abrir la página e ingresar el nombre. Debe ser lo primero. |
| `propose` | `productIds: number[]` (1–10 ids) | Al proponer uno o varios productos del catálogo. |
| `vote` | `productId: number` | Al votar un producto. |
| `unvote` | `productId: number` | Al retirar el propio voto. |
| `remove` | `productId: number` | Al quitar un producto de la lista. |

Ejemplo: `{"type":"propose","productIds":[1,5,999]}`

### 3.2 Servidor → Participante (WebSocket)

| `type` | Campos | Cuándo se envía |
|---|---|---|
| `state` | `you: {id,name}`, `participants: {id,name}[]`, `products: ProductView[]` | Al entrar (estado completo, sin esperar cambios) y ante **cada** cambio: entrada/salida, propuesta, voto, des-voto o quitar. Se envía uno por participante, con su propio `you`. |
| `proposeResult` | `added: number[]`, `failures: {productId, reason, message}[]` | Solo a quien propuso, al terminar su propuesta. `reason` ∈ `not_found`, `timeout`, `catalog_error`, `duplicate`, `invalid`. |
| `error` | `code: string`, `message: string` | Solo a quien envió un mensaje inválido o no permitido. Códigos: `INVALID_JSON`, `UNKNOWN_TYPE`, `INVALID_MESSAGE`, `INVALID_NAME`, `INVALID_PRODUCT_IDS`, `INVALID_PRODUCT_ID`, `NOT_JOINED`, `ALREADY_JOINED`, `PRODUCT_NOT_FOUND`, `ALREADY_VOTED`, `NOT_VOTED`, `FORBIDDEN`, `INTERNAL`. |

`ProductView` = `{ id, title, price, image, votes, proposedBy: {id,name},
voters: {id,name}[] }`. El ranking se envía ordenado por `votes` descendente
(desempate por `id`).

**Los errores de una propuesta ajena nunca se difunden**: `proposeResult` va
solo al autor; a los demás solo les llega un `state` con los productos que se
agregaron efectivamente.

### 3.3 Servidor → Pantalla (SSE, `EventSource`)

Un único evento llamado `state`:

```
event: state
data: {"type":"state","participantCount":3,"participants":[...],"products":[...],"serverTime":"..."}
```

| `type` | Campos | Cuándo se envía |
|---|---|---|
| `state` | `participantCount`, `participants`, `products`, `serverTime` | Al conectar (estado inicial) y ante cada cambio del servidor. |

La pantalla **nunca envía nada**: no hay endpoint de escritura para ella.

---

## 4. Decisiones tomadas

**Nombres aceptados.** Se recorta el nombre (`trim`) y se aceptan entre 1 y 20
caracteres. Se permiten **nombres repetidos** (cada participante tiene un `id`
único), porque dos personas pueden llamarse igual. Los mensajes `join` vacíos o
largos se rechazan con `INVALID_NAME`. Si alguien no hace `join` en 15 s, se
cierra su conexión.

**Producto repetido.** No se agregan duplicados. Un id ya presente en la lista
(o repetido dentro de la misma propuesta) produce un `failure` con
`reason: "duplicate"` solo para quien propuso, y no altera el estado.

**Quién puede quitar productos.** Puede quitarlos **quien lo propuso**, o
**cualquier participante si el producto tiene 0 votos**. Así se evita que un
producto quede "atascado" cuando su autor se desconecta, pero se protegen los
productos con votos. La regla se aplica en el servidor (`SharedList.remove`),
que responde `FORBIDDEN` si no se cumple.

**Votos y desconexión.** Cada participante vota como máximo una vez por
producto; un segundo voto da `ALREADY_VOTED`. Al desconectarse, sus votos se
liberan, de modo que el ranking refleja solo a quienes están conectados.

**Timeout del catálogo.** 5000 ms por producto, configurable con
`CATALOG_TIMEOUT_MS`. DummyJSON suele responder en menos de 1 s; 5 s cubren
latencia normal y delays moderados sin dejar al usuario esperando demasiado.
Se implementa con `AbortController`. Un delay simulado mayor al timeout
demuestra la tolerancia a fallos.

**Parámetro `delay`.** Se agrega `?delay=<CATALOG_DELAY_MS>` a cada consulta,
lo que permite simular un catálogo lento sin cambiar código.

---

## 5. Comportamiento ante fallos y demoras del catálogo

- **Producto inexistente:** el autor recibe un `failure` con `not_found`; el
  resto de la propuesta se agrega igual.
- **Catálogo lento / sin respuesta:** mientras se consulta, quien propone ve
  «Consultando el catálogo…» con un spinner; el ranking sigue igual hasta que
  llegan los datos. Al superar el timeout, el autor recibe `timeout`. Los demás
  participantes **no se enteran** y siguen operando con normalidad, porque la
  espera es asíncrona y no bloquea el event loop.
- **Error de red o datos incompletos:** se informa como `catalog_error`.
- En todos los casos, el autor ve el detalle en el panel **Resultados**; los
  productos válidos aparecen en el ranking apenas se aplican.

Mensajes inválidos (JSON roto, tipo desconocido, campos faltantes, valores fuera
de rango, acciones no permitidas) reciben un `error` **solo a quien los envió** y
nunca caen al servidor: el `catch` del handler responde `INTERNAL` si hiciera
falta.

**Conexiones cerradas.** Al cerrar la pestaña, el servidor elimina al
participante, libera sus votos, deja de enviarle mensajes, cancela sus timers y
emite un `state` nuevo. Hay además un heartbeat con `ping`/`pong` cada 30 s que
termina conexiones muertas. La pantalla (SSE) se reconecta sola mediante
`EventSource`; el participante tiene reconexión automática y recupera su nombre
desde `sessionStorage` (con `id` nuevo).

---

## 6. ¿Por qué WebSocket y SSE?

**Participantes → WebSocket.** Necesitan comunicación **bidireccional**: envían
`join`, `propose`, `vote`, `unvote`, `remove` y reciben actualizaciones al
instante. WebSocket (API nativa del navegador, sin Socket.IO ni protocolos
propios) ofrece un canal persistente y de baja latencia en ambos sentidos, con
cierre de conexión detectable para actualizar la lista de presentes.

**Pantalla → SSE.** Solo **recibe** datos; nunca envía. SSE (`EventSource`) es un
flujo HTTP unidireccional simple: el navegador lo reconecta automáticamente,
soporta eventos nombrados y no requiere manejar un protocolo de mensajes
entrantes. Es la herramienta mínima y suficiente para un consumidor solo de
lectura.

**Si la pantalla usara polling:** tendría que consultar periódicamente
(ej. cada 1–2 s) con peticiones HTTP, lo que implicaría más tráfico, latencia
promedio mayor, llamadas innecesarias cuando no hay cambios y mayor carga en el
servidor. SSE entrega cada cambio apenas ocurre, sin recargar ni sondear.

---

## 7. Pruebas automatizadas

`npm test` usa `node:test` y cubre: parseo/validación de mensajes (JSON inválido,
tipo desconocido, campos faltantes, rangos, nombres), orden del ranking y
consistencia del estado (duplicados, doble voto, regla de quitar, liberación de
votos al salir).

### Verificación manual sugerida

1. Abrir 3 participantes y la pantalla.
2. El que entra tarde debe ver el estado completo y los demás conectados.
3. Proponer `1, 5, 999999`: se agregan los válidos y solo el autor ve el fallo.
4. Con `CATALOG_DELAY_MS=3000`, proponer desde una pestaña y votar desde otra:
   la segunda sigue funcionando mientras la primera espera.
5. Proponer/votar el mismo producto casi simultáneamente desde dos pestañas: no
   hay duplicados y se cuentan ambos votos.
6. Cerrar una pestaña: todos y la pantalla ven un participante menos.
7. Desde la consola del navegador (la página expone `window.tp4` para esto):
   - `tp4.sendRaw('{ roto')` → `INVALID_JSON`
   - `tp4.send({ type: 'xxx' })` → `UNKNOWN_TYPE`
   - `tp4.send({ type: 'propose', productIds: [] })` → `INVALID_PRODUCT_IDS`

   En todos los casos llega un `error` solo a esa pestaña y el servidor sigue
   funcionando.

---

## 8. Estructura

```
tp4-realtime/
├── src/
│   ├── types.ts        # contrato tipado
│   ├── validation.ts   # validación pura (testeable)
│   ├── config.ts       # variables de entorno
│   ├── catalog.ts      # fetch con timeout + delay
│   ├── store.ts        # estado en memoria y reglas
│   └── server.ts       # HTTP + WebSocket + SSE
├── public/
│   ├── index.html      # participante
│   ├── screen.html     # pantalla
│   ├── participant.js
│   ├── screen.js
│   └── styles.css
├── test/
│   └── validation.test.ts
├── .env.example
├── package.json
└── tsconfig.json
```

## 9. Evidencia

La carpeta `evidencia/` contiene el **GIF con tres participantes y la pantalla
sincronizados** y las capturas de: propuesta con fallos parciales (y cómo la ve
otro participante), catálogo lento y respuesta a mensajes inválidos.

Se generan de forma reproducible con:

```bash
npm run build
npm run evidence
```

Requiere Chrome o Edge instalado (o definir `CHROME_PATH`). El listado detallado
de archivos está en `evidencia/README.md`.
