# CONTEXTO — CRM Kapta Viral (Álvar)

> Documento de traspaso. Está escrito para que otra IA (u otra persona) pueda
> trabajar en este repositorio sin haber visto ninguna conversación previa.
> Última actualización: 2026-09-03.

---

## 0. Cómo leer este documento

**Jerarquía de fuentes, de mayor a menor autoridad:**

| Nivel | Fuente | Cuándo manda |
|---|---|---|
| 1 | **El código de `app/src/`** | Siempre. Es lo único que está desplegado y corriendo |
| 2 | **Este documento** | Para el porqué, el estado y lo que no se ve en el código |
| 3 | `spec/00-DECISIONES-CERRADAS.md` | Para las reglas de negocio. **El stack que describe está obsoleto** |
| 4 | `app/README.md` | Puesta en marcha. Tiene 3 datos caducados, señalados en §4 |
| 5 | El PDF original (280 pág., fuera del repo) | Solo como arqueología. Se contradice a sí mismo 14 veces |

**Si el código y la spec discrepan, manda el código.** La spec se escribió antes
de construir y varias decisiones cambiaron durante la construcción. Las
diferencias concretas están en §5 y §15.

---

## 1. Qué es esto

Un **CRM comercial a medida** para operar la venta de un programa formativo de
alto ticket. No es un CRM genérico: modela un embudo concreto, con un
vocabulario concreto, y hace cumplir reglas de integridad que un CRM de
catálogo no haría cumplir.

**Cliente:** Álvar Sola. Negocio: **Kapta Viral**, programa *YouTube Faceless*.
**Ticket:** 3.000 € (`ticketCents = 300000`). **Mercado:** España, en euros.
**Encargo:** escribir la especificación técnica final **y construirla**.
**Plazo:** menos de 4 semanas desde el 2026-08-31.

### Los dos negocios que conviven

Esta es la decisión estructural más importante del sistema. El CRM opera **dos
embudos distintos a la vez**, separados por `launches.type`:

| | `launch` (Lanzamiento) | `evergreen` (Evergreen) |
|---|---|---|
| Entrada | Ads → landing → formulario | DM de Instagram (ManyChat) |
| Recorrido | Clases → directo → Calendly → reunión → cierre | Conversación → compra directa |
| Cierre | Reunión con closer | Hotmart, sin reunión |
| Ritmo | Picos alrededor del directo | Constante |

**Por qué importa:** mezclarlos miente en las dos direcciones. Un evergreen que
vende constante todo el mes hunde el *close rate* del lanzamiento; y un
lanzamiento con un pico de ventas infla el del evergreen. De ahí el selector de
alcance (§12) y el hecho de que el embudo cambie de forma según el negocio (§10).

### El embudo del lanzamiento

```
Ads → Landing → Registro → Grupo → Clase 1 → Llamada setter (cualificación)
    → Directo → Calendly → Reunión con closer → Cierre → Cobro
```

---

## 2. Estado real, hoy

**Lo que funciona y está verificado:**

- La aplicación compila, tipa (`npm run typecheck`) y pasa **21 comprobaciones de integridad** del schema (`npm run verify`)
- Las tres interfaces (Propietario / Setter / Closer) se han recorrido enteras en el navegador con datos reales
- Base de datos **Neon** en producción, región **aws-eu-central-1 (Frankfurt)**, proyecto `crm-kapta-viral`, id `hidden-fire-60607259`, base `crm`, rol `crm_owner`
- Autenticación real: scrypt + cookie firmada con HMAC. Verificado: contraseña incorrecta se rechaza, cookie falsificada se rechaza, `/owner` redirige a login
- Repositorio **público**: <https://github.com/eyuel3ev-gif/crm-kapta-viral>
- **Demostración navegable publicada**: <https://eyuel3ev-gif.github.io/crm-kapta-viral/> — 511 pantallas estáticas, 9.915 enlaces internos, ninguno roto

**Lo que NO funciona:**

- 🔴 **El despliegue de Netlify devuelve 404 en todas las rutas.** El sitio existe (`crm-kapta-viral.netlify.app`, id `6f99621d-ff96-4118-acae-6485a4815268`) y el último deploy figura como `ready`, pero sirve vacío. **Causa:** se desplegó por CLI y eso no dispara la detección de framework de Next.js. **Solución pendiente:** en Netlify, *Link repository* → GitHub → `crm-kapta-viral` → Deploy. Requiere que lo haga una persona desde el panel
- ❌ No hay dominio propio conectado
- ❌ Calendly: `CALENDLY_WEBHOOK_SIGNING_KEY` está **vacía** en producción. El endpoint es el único que autentica por firma, así que hoy rechazaría todo
- ❌ No hay ni un solo test. La única verificación automática es `npm run verify`

**Advertencia de jurisdicción:** los datos se *almacenan* en Frankfurt, pero las
Netlify Functions se ejecutan en **CMH (Ohio)**. El tratamiento ocurre en EE. UU.
No es "todo en Europa".

---

## 3. Arranque en 30 segundos

```bash
cd app && npm install && npm run dev
```

Sin `DATABASE_URL`, la app levanta un **Postgres embebido** (PGlite, WebAssembly)
en `./.pglite`, crea el schema y siembra 78 leads repartidos por todo el embudo.
No hace falta instalar Postgres ni configurar nada.

Abrir <http://localhost:3000>. Con `DEV_AUTH=true` aparece un selector de usuario
sin contraseña.

**Comandos de verificación:**

```bash
npm run typecheck    # tipos
npm run verify       # 21 comprobaciones del schema, sin BD
npm run build        # build de producción
```

---

## 4. ⚠️ Las cinco minas

Léelas antes de tocar nada. Todas están verificadas contra el código.

### 4.1 `app/.env.local` apunta a PRODUCCIÓN

En esta máquina, `.env.local` define `DATABASE_URL` hacia la base de **Neon de
producción** y `DEV_AUTH=true`. Next carga `.env.local` automáticamente, así que
**`npm run dev` aquí NO usa PGlite: usa producción**, y además habilita el
selector de usuario sin contraseña.

→ Para trabajar en local de verdad: renombra `.env.local` o vacía `DATABASE_URL`.

### 4.2 `npm run db:seed` BORRA LA BASE ENTERA

`seed()` empieza con un `TRUNCATE` de las 29 tablas con `RESTART IDENTITY CASCADE`
(`app/src/db/seed.ts:41-64`). El README lo presenta como *"datos de ejemplo
(opcional)"*, lo cual es engañoso: ejecutarlo con `DATABASE_URL` apuntando a
producción **destruye todos los datos**.

→ El comando seguro para instalar `init.sql` contra un Postgres real es
**`npm run db:init`**, no `db:seed`.

### 4.3 `npm run build` con el servidor de desarrollo abierto rompe la app

El build de producción sobrescribe `.next` y el dev server se queda sin sus
chunks. Síntoma: pantalla en blanco o `[object Event]` en el overlay de Next.

```bash
rm -rf .next && npm run dev
```

Los datos no se pierden, viven en `.pglite/`.

### 4.4 Un array vacío de `launchIds` vacía el dashboard sin dar error

`launchIds` tiene tres estados y **el array vacío no significa "sin filtro"**:
fuerza `sql\`false\`` y devuelve todo a cero (`metrics.ts:34-38`, `queries.ts:34-38`).
`null` es "sin filtro"; `[]` es "ningún lanzamiento".

### 4.5 Los secretos están en claro en el directorio de trabajo

`PRODUCCION.env`, `app/.env.local` y `app/.env.neon` comparten la contraseña de
la base de producción en texto plano. Los tres están en `.gitignore` y **se ha
verificado que ninguno está rastreado por git**, pero el repositorio es público:
cualquier commit descuidado los expondría.

Además, las variables de entorno de Netlify **no están marcadas como secretas**
(se creó con `envVarIsSecret: true` y la API las descartó en silencio; hubo que
recrearlas sin la marca). Cualquiera con acceso al equipo de Netlify puede leer
la contraseña de Neon.

---

## 5. El stack REAL

⚠️ **`spec/00-DECISIONES-CERRADAS.md` describe un stack que no es el que se
construyó.** Esta tabla es la verdad:

| Capa | La spec dice | **Lo que hay** |
|---|---|---|
| Frontend + API | Next.js 15 App Router + TS | ✅ igual |
| UI | Tailwind + **shadcn/ui** | Tailwind v4 + **componentes propios** (`src/components/ui.tsx`) |
| Base de datos | **Supabase** | **Neon** (Supabase pausa el proyecto a los 7 días sin actividad; los webhooks fallarían en silencio) |
| Auth | **Supabase Auth** | **Propia**: scrypt + cookie HMAC (`src/lib/auth.ts`) |
| ORM | Drizzle, SQL-first | ✅ igual |
| Cron / jobs | **Inngest** | **GitHub Actions**, cada 10 min |
| Email | **Resend** | **No hay** |
| Hosting | **Vercel** | **Netlify** (el plan Hobby de Vercel prohíbe el uso comercial) |
| IA | Claude Opus 5 | No implementado en V0 |

**Coste objetivo: 0 €/mes.** Netlify Starter + Neon free (0,5 GB) + GitHub Actions.

---

## 6. Arquitectura: la regla de oro

> **Los controladores no tienen lógica. Todo lo que decide algo vive en `domain/`.**

Las páginas leen y pintan; los webhooks parsean y delegan. Es lo que permite que
el mismo cierre de venta se comporte igual desde la interfaz, desde un webhook o
desde un script.

```
app/src/
  db/          schema Drizzle (29 tablas) · init.sql · seed · doble driver
  lib/         auth, permisos, alcance, teléfono E.164, dinero, fechas, labels
  domain/      TODA la regla de negocio
    state         máquina de estados del lead (9 estados con rango)
    leads         alta, deduplicación, atribución, tokens
    setter-calls  llamadas, reintentos, cualificación
    meetings      reuniones, resultados, ventas, reagendado
    external-sales ventas que nacen fuera (Hotmart)
    events        outbox transaccional + activity log + audit log
    tasks         tareas y Smart Tasks con dedupe
    automation    las reglas del cron
    metrics       registro canónico de métricas
    queries       lecturas por rol
  app/         páginas (owner/ setter/ closer/) + rutas API
```

### El doble driver

`src/db/index.ts` monta dos motores intercambiables:

- Con `DATABASE_URL` → `postgres-js` (`{ max: 10, prepare: false }`)
- Sin ella → **PGlite**, Postgres compilado a WebAssembly, persistido en `./.pglite`

La conexión es **perezosa**: `db` es un `Proxy` que resuelve `getDb()` en cada
acceso. Importar el módulo no abre ninguna conexión.

Dos ayudas existen por culpa de las diferencias entre drivers:

- **`firstRow()`** — `postgres-js` devuelve un array; PGlite devuelve `{ rows }`. Leer `[0]` a pelo funciona en uno y explota en el otro
- **`execRaw()`** — `db.execute()` usa el protocolo extendido de Postgres, que admite una sola sentencia y no digiere los bloques `DO $$ … $$`

**`bootstrap.ts`** solo actúa en modo embebido: si no hay schema, aplica **todas**
las migraciones y siembra. Se dispara desde `layout.tsx:13` con `ensureDbReady()`.
Contra un Postgres real no toca nada — ahí las migraciones se aplican a mano.

---

## 7. Modelo de datos — 29 tablas

`app/src/db/schema.ts` (660 líneas). Se declara espejo de `spec/02-SCHEMA-V0.sql`,
pero ya no lo es del todo: la spec tiene **30** tablas — la de más es
`meeting_transcripts`, que **no existe en el código** (las transcripciones se
retiraron del alcance).

### Cuatro reglas transversales

1. **Dinero en céntimos enteros, nunca float.** `0.1 + 0.2 !== 0.3`, y eso en una columna de revenue acaba en un descuadre que nadie sabe explicar
2. **Timestamps con zona, guardados en UTC.** Se pintan con `formatInTimeZone` sobre `TZ = 'Europe/Madrid'`
3. **`NULL` ≠ `false` ≠ `0`.** `webinar_attended` nace `NULL` y ninguna llamada lo escribe: no hay fuente fiable de quién entró al Zoom
4. **PK `uuid` con `defaultRandom()`** en todas salvo `roles` (code), `lead_tokens` (token) y `automation_settings` (key)

### Las tablas

| Grupo | Tablas |
|---|---|
| Lanzamiento | `launches`, `launch_events`, `automation_settings` |
| Personas | `users`, `roles`, `user_roles` |
| Leads | `leads`, `lead_attribution`, `lead_tokens`, `lead_merge_candidates`, `lead_activity` |
| Formularios | `form_versions`, `form_questions`, `form_submissions`, `form_answers` |
| Setter | `setter_calls`, `setter_call_questions`, `setter_call_answers` |
| Reuniones | `meetings`, `meeting_schedule_history` |
| Comercial | `sales`, `payments`, `loss_reasons`, `objection_types` |
| Trabajo | `tasks` |
| Sistema | `domain_events`, `audit_log`, `webhook_events` |

### El porqué de las decisiones que sorprenden

- **`leads` tiene tres campos de estado.** `status` es el estado **comercial** (una sola dimensión, la del embudo). `contact_status` y `qualification_status` son dimensiones **operativas** separadas a propósito: *«¿he podido hablar con él?»* y *«¿es buen lead?»* son preguntas distintas, y mezclarlas hace imposible saber si el tráfico es malo o si llamamos mal
- **`leads.revenue_cents` es derivado.** Se recalcula dentro de la transacción de venta sumando solo ventas con `status='active'`. Jamás se escribe a mano
- **`setter_calls.call_group_id`** agrupa los reintentos de la misma llamada lógica. Sin esto, 3 intentos al mismo lead cuentan como 3 leads en el `contact_rate`
- **`meetings` tiene DOS campos de resultado.** Ver §9.2
- **Reagendar no crea una reunión nueva.** Mueve `scheduled_at` y deja rastro en `meeting_schedule_history`. Crear una segunda inflaría el `show_rate` con una cita que nunca existió
- **`payments` existe porque con ticket de 3.000 € y financiación el impago no es raro.** Sin esa tabla el revenue miente desde el mes 2, y el ROAS con él
- **«Vencida» no es un estado de `tasks`.** No se guarda, se calcula. Un estado mutable se desincroniza en cuanto alguien mueve la fecha
- **`form_answers` y `setter_call_answers` guardan `question_text_snapshot NOT NULL`**: la pregunta **exacta** que vio el lead. Si mañana se reescribe el texto, la respuesta de ayer sigue significando lo que significaba
- **`lead_activity` y `audit_log` no se pueden fusionar.** Uno cuenta la historia comercial legible del lead; el otro es trazabilidad técnica de quién cambió qué
- **`domain_events` es un outbox transaccional**: se escribe DENTRO de la misma transacción que la mutación, y un worker lo despacha después. De ahí salen el Activity Log, las Smart Tasks y las notificaciones
- **`automation_settings` es una tabla y no constantes en código**: cadencias, umbrales y ventanas se cambian sin desplegar

### `init.sql` — lo que Drizzle no genera

- La secuencia **`lead_public_seq`**, que alimenta el `public_id` legible (`LD-000184`). Es una secuencia y no un `count(*)` porque con dos altas simultáneas el count devuelve el mismo número a las dos
- **7 CHECK constraints** sobre los enums de estado

---

## 8. Vocabulario del dominio

Traducirlo mal es la forma más rápida de romper el sistema.

### Estados del lead (`leads.status`) y su RANGO

`domain/state.ts` define 9 estados **con un rango numérico**. El rango no es
orden de visualización: **es la regla de negocio**.

| Estado | Rango |
|---|---|
| `new` | 0 |
| `contacted` | 10 |
| `disqualified` | 15 |
| `qualified` | 20 |
| `meeting_scheduled` | 30 |
| `meeting_held` | 40 |
| `follow_up` | 45 |
| `lost` | 90 |
| `won` | 100 |

**Para qué sirve:** `applyAutomaticStatus(actual, propuesto)` deja pasar el cambio
**solo si sube de rango**. Es el único mecanismo que impide que un webhook
atrasado degrade un lead ya avanzado — que `won` vuelva a `new` porque llega
tarde un evento antiguo.

Detalles no obvios:
- `disqualified` (15) está **por debajo** de `qualified` (20): descalificar es un estado poco avanzado, no un final
- `lost` (90) está casi al nivel de `won` (100): un lead perdido es casi terminal para las automatizaciones
- `won` es terminal absoluto (`won: []` en la tabla de transiciones)
- `meeting_scheduled` se permite a sí mismo: eso es reagendar

### Otros ejes

| Término | Significado |
|---|---|
| `contact_status` | `not_attempted` \| `attempted` \| `contacted` \| `unreachable` |
| `qualification_status` | `not_assessed` \| `qualified` \| `disqualified`. `not_assessed` significa **«no lo sabemos»**, no «no vale» |
| `leads.channel` | `form` \| `instagram_dm` \| `manual` |
| `eligible_for_setter` | Mete al lead en la cola del setter. **Solo lo activa el formulario `PRECLASS_PROFILE`** |
| `meetings.status` | Qué pasó con la **cita**: `scheduled` \| `completed` \| `no_show` \| `cancelled` |
| `meetings.commercial_result` | Qué pasó con la **venta**: `pending` \| `won` \| `lost` \| `follow_up` |
| `meeting_number` | Ordinal **dentro del lead**, no global. `unique(lead_id, meeting_number)` |
| `liveConfirmation` | Intención declarada de asistir al directo. **NO es asistencia** |
| `webinar_attended` | Asistencia real. Se deja **NULL** a propósito: no hay fuente fiable |
| `sales.status` | `active` (la única que suma revenue) \| `refunded` \| `defaulted` (reservado a contracargo) |
| `launches.type` | `launch` \| `evergreen` |
| `touch` | `first` \| `last`. **Solo se escribe `first`** (ver §15.4) |

---

## 9. Las reglas de negocio

Vienen de las 14 contradicciones del PDF resueltas en `spec/00-DECISIONES-CERRADAS.md`.
No son estilo: son integridad.

### 9.1 Idempotencia — cuatro claves distintas

| Qué protege | Mecanismo |
|---|---|
| Un webhook repetido no duplica nada | `unique(provider, external_event_id)` en `webhook_events` |
| Calendly reenvía la misma reserva | `unique(external_provider, external_booking_id)` en `meetings` |
| El cron no genera 12 tareas iguales | `tasks.dedupe_key` |
| Doble clic en «Ganado» no crea dos ventas | `sales.idempotency_key` |
| La landing reintenta el POST | `idempotency-key` del submission + deduplicación por teléfono/email |
| Meeting #2 nunca sobrescribe la #1 | `unique(lead_id, meeting_number)` |

### 9.2 Asistencia ≠ resultado comercial

Los dos campos de `meetings` están separados porque **una reunión puede estar
`completed` con resultado `follow_up`**. Y sobre todo:

> El no-show es un **estado operativo, no una pérdida comercial**. Un no-show se
> reagenda. Marcarlo perdido automáticamente destruye leads recuperables.

Meterlo todo en un solo campo es, literalmente, el error nº 2 que señala la spec.

### 9.3 Deduplicación — la regla que no se rompe

> **NO se fusionan dos personas solo porque se parezca el nombre.**

Orden de confianza (`domain/leads.ts:46-60`):

1. Teléfono exacto → `exact`, confianza 1.0
2. Email exacto sin conflicto → `exact`, 0.98
3. Email exacto pero con conflicto → `candidate`
4. Nada → `none`

`exact` reutiliza la ficha (**completando huecos, nunca pisando lo que ya había**).
`candidate` crea ficha nueva **y anota el par en `lead_merge_candidates`** para
revisión humana. Un duplicado revisable es barato; una fusión equivocada, no.

Todo esto depende de `lib/phone.ts`: si `«612 34 56 78»`, `«+34612345678»` y
`«0034 612345678»` no colapsan al mismo string, el matching no sirve. Un teléfono
ininterpretable devuelve **`null`**, no un intento — inventarse un prefijo fusiona
a dos personas distintas.

### 9.4 No contestar NO descalifica

Al agotar los intentos, `contact_status = 'unreachable'` y
`qualification_status` **se queda en `not_assessed`**: no hemos podido evaluarlo,
que no es lo mismo que haberlo evaluado y descartado.

### 9.5 Los reintentos son filas nuevas

Nunca se sobrescribe el intento anterior. Cada reintento es una fila más en
`setter_calls` con el **mismo `call_group_id`** y `attempt_number` incrementado.
Política por defecto: 3 intentos, el primer reintento a los 180 min, los
siguientes al día siguiente a las 11:00. Configurable en `automation_settings`.

### 9.6 Perder exige motivo; seguir exige fecha

`validateResult()` valida **en servidor** (*«el `required` del navegador no es una
validación»*):

- `lost` sin motivo de catálogo → rechazado. El texto libre no se agrega, así que
  «precio aparece en el 37 % de las pérdidas» no se podría calcular
- `follow_up` sin fecha → rechazado. *«Un seguimiento sin fecha es un lead
  olvidado con otro nombre»*

La ficha de un lead perdido **no se borra**: sirve para análisis y recuperación.

### 9.7 Las reversiones se marcan, no se borran

Un reembolso o contracargo pone `sales.status` en `refunded`/`defaulted`.
Borrar la venta *«dejaría un mes cerrado que ya no cuadra con lo que se cobró, y
sin rastro de por qué»*.

### 9.8 El revenue es siempre derivado

Se recalcula sumando `sales` con `status='active'`. **Nunca se acumula ni se
escribe a mano**, y nunca se calcula sumando reuniones.

---

## 10. Métricas — definiciones exactas

`domain/metrics.ts` es el **registro canónico**: una función por métrica, y todo
el sistema lee de aquí. *«Si el dashboard calculara el close rate por su cuenta,
en tres meses habría tres close rates distintos.»*

**Dos reglas heredadas de la spec:**

1. **División por cero devuelve `null`**, nunca `Infinity` ni `0`. En pantalla se pinta `—`. *«Un ROAS 0 % es tan mentira como un ROAS infinito: lo que pasa es que todavía no hay datos»*
2. **Cada ratio lleva su denominador en el nombre.** *«Booking rate a secas no significa nada hasta saber sobre qué se divide»*

### Las fórmulas

| Métrica | Fórmula |
|---|---|
| `contactRate` | contactados / **leads con al menos un intento** (no todos los leads: eso castiga al setter por leads que aún no le tocaba llamar) |
| `qualificationRate` | cualificados / contactados |
| `showRate` | `meetingsHeld / (meetingsHeld + noShows)`. **El denominador NO son las agendadas** |
| `closeRateMeetings` | `salesWonWithMeeting / meetingsHeld` |
| `closeRateLeads` | `salesWonWithMeeting / leadsWithMeeting` |
| `avgTicketCents` | `revenueCents / salesWon` ← la **única** que divide por todas las ventas |

### `salesWonWithMeeting` — por qué existe

Es el único numerador válido para un close rate sobre reuniones. Contar ahí las
compras directas de Hotmart, que no pasan por reunión, produce ratios por encima
del 100 %. **Ocurrió de verdad: el dashboard llegó a mostrar 166,7 %** (15 ventas,
9 de ellas de Hotmart, entre 9 reuniones). Corregido y commiteado el 2026-09-03.

Las dos tasas de cierre **comparten numerador** y difieren solo en el denominador:
un lead con 3 reuniones cuenta 3 veces en la primera y 1 en la segunda. Son
preguntas distintas, no dos formas de calcular lo mismo.

### Modo actividad vs modo cohorte

- **Actividad**: qué ocurrió en el periodo. Una venta de hoy cuenta hoy
- **Cohorte**: qué han hecho los leads captados en el periodo. Esa misma venta cuenta en la semana en que entró el lead

Técnicamente: en cohorte el `WHERE` de reuniones y ventas usa `leads.registered_at`;
en actividad usa la fecha del propio hecho.

⚠️ **Consecuencia esperada, no un bug:** una cohorte reciente parecerá tener un
close rate bajísimo, porque sus ventas todavía no han ocurrido.

### Otros comportamientos

- **`sampleWarning`**: entre 1 y 9 reuniones realizadas se avisa de que los ratios no son concluyentes. Con 0 no se avisa
- **El embudo cambia de forma según el negocio.** En Evergreen no hay reuniones: pintar «Reuniones agendadas 0» y después «Ventas 9» dibujaría una caída al 0 % seguida de una resurrección imposible
- **El cuello de botella se mide por volumen perdido, no por el porcentaje más bajo.** Una etapa que convierte al 30 % pero está en su nivel normal importa menos que una que ha caído del 75 % al 60 %
- **Los ratios van siempre acompañados del volumen.** Un 80 % sobre 10 leads no es mejor que un 68 % sobre 140: es una muestra distinta

---

## 11. Integraciones

Los cinco endpoints declaran `export const runtime = 'nodejs'`. Contrato de
respuesta uniforme: éxito `{ data: … }`, error `{ error: { code, message?, details? } }`.

**Todos son fail-closed**: la condición es `!process.env.X || token !== process.env.X`,
así que si la variable no está definida el endpoint devuelve 401. No hay modo
"sin autenticación por accidente".

**Ningún evento se pierde**: los tres webhooks capturan el error, escriben
`status:'failed'` con `errorMessage` en `webhook_events` y devuelven 500 para que
el proveedor reintente.

| Endpoint | Auth | Idempotencia |
|---|---|---|
| `POST /api/webhooks/hotmart` | cabecera `x-crm-token` ← `HOTMART_WEBHOOK_TOKEN` | `(hotmart, transaction_id)` |
| `POST /api/webhooks/manychat` | cabecera `x-crm-token` ← `MANYCHAT_WEBHOOK_TOKEN` | doble: `(manychat, contact_id)` + `leads.external_contact_id` |
| `POST /api/webhooks/calendly` | firma HMAC `calendly-webhook-signature` ← `CALENDLY_WEBHOOK_SIGNING_KEY` | `payload.uri` |
| `POST /api/public/lead` | cabecera `x-crm-token` ← `PUBLIC_FORM_TOKEN` | `idempotency-key`, o sha256 derivada |
| `GET /api/cron` | `Authorization: Bearer` ← `CRON_SECRET` | todas las reglas son idempotentes |

### Hotmart (vía Zapier)

Acepta un payload **flexible con alias por campo** (`.passthrough()`) porque el
mapeo lo decides en el Zap y los nombres de Hotmart pueden cambiar sin avisar.
Cada estado se acepta en tres formas: la nativa `PURCHASE_*`, la corta y la
castellana.

**`ACKNOWLEDGED`** es el conjunto de eventos que se **reconocen pero NO tocan la
contabilidad**: `purchase_protest` (disputa abierta), `purchase_delayed` (pago
retrasado), `purchase_billet_printed` (boleto impreso). Responden 200 con
`accountingChanged: false`. Un estado desconocido se guarda como `failed` y
responde 422 — no se toca la contabilidad ante la duda.

**Interpretación de importes** (`toCents`): un entero ≥ 1000 se asume ya en
céntimos; cualquier otro número se multiplica por 100.

### ManyChat / Instagram DM

**Decisión de arquitectura explícita: el CRM NO duplica la bandeja de entrada de
Instagram.** Replicarla exigiría la Instagram Messaging API con revisión de app.
Se guarda la identidad del contacto y el enlace a la conversación; se responde en
Instagram.

Un DM entrante se trata como **conversación ya abierta**: el lead nace con
`eligibleForSetter: true`, `contactStatus: 'contacted'` y `status: 'contacted'`.
Se adscribe al lanzamiento **evergreen**.

Asignación de setter: si ManyChat manda `assign_to` (email), manda eso; si no,
round-robin por `users.lastAssignedAt nulls first`.

### Calendly

- **Reprogramación**: mueve la hora de la reunión existente, no crea otra
- **Cancelación**: busca por `(calendly, external_booking_id)` y llama a `cancelMeeting`
- **Teléfono**: lo busca en `text_reminder_number` y, si no, barriendo `questions_and_answers` con etiquetas que contengan «tel», «whatsapp», «móvil»
- La firma se calcula sobre los **bytes exactos**, por eso el cuerpo se lee con `req.text()`

### `/api/public/lead` — cuatro defensas

Sin ellas, *«un bot ensucia el CPL y llena la cola del setter de basura»*:
token en cabecera, rate limit por IP, **honeypot** (campo `website`) e
idempotencia. El honeypot responde **200 mintiendo**, sin crear nada, para que el
bot no sepa que ha sido detectado.

### El cron

**GET**, no POST. Corre cada 10 minutos vía GitHub Actions (`.github/workflows/cron.yml`,
secretos `CRM_URL` y `CRON_SECRET`, ya configurados).

Va en GitHub Actions y no en el hosting porque el cron de los planes gratuitos
suele limitarse a una ejecución diaria, y la confirmación de 24 h necesita
revisarse a menudo. Cualquier código distinto de 200 se trata como error y el job
sale con 1: un fallo silencioso significa que nadie confirma las reuniones de
mañana.

`skipped` es la métrica que confirma que la deduplicación funciona.

---

## 12. Auth, permisos y alcance

### Sesiones

Formato de cookie: **`userId.expires.firma`**, con `expires` en milisegundos y
firma `HMAC-SHA256(SESSION_SECRET, "userId.expires")`.

- Verificación en **tiempo constante** (`timingSafeEqual`), comparando longitudes antes
- `SESSION_SECRET` es obligatorio, mínimo 32 caracteres. Sin él, la app no arranca
- Cookie `httpOnly`, `sameSite: 'lax'`, 14 días, `secure` solo en producción
- **No hay tabla de sesiones**: para cinco personas sería complicarlo por nada. El precio es que cerrar sesión en un dispositivo no la cierra en los demás
- `getSession()` **relee al usuario en cada petición**: desactivar a alguien le cierra la puerta en el acto

### Contraseñas

`scrypt` (viene en Node, cero dependencias, y es deliberadamente lento y caro en
memoria). Formato: `scrypt$<sal base64>$<hash base64>`.

- `verifyPassword(plain, null)` devuelve `false` por diseño: sin contraseña guardada no se entra
- **Mismo mensaje de error** para «no existe» y «contraseña incorrecta»: distinguirlos permite averiguar qué emails tienen cuenta

### `DEV_AUTH`

El selector de usuario sin contraseña. **Se apaga solo**: exige
`DEV_AUTH === 'true'` **y** `NODE_ENV !== 'production'`.

### Permisos

Tres roles sobre un catálogo cerrado de **23 permisos**. Owner los tiene los 23;
Setter 4; Closer 6. Un usuario puede tener **varios roles** (`user_roles`), y
`can()` es la unión.

> **Esconder un botón NO es un permiso.** Todo se comprueba en el servidor,
> dentro de la server action.

- **Setter está ciego al dinero**: nada de revenue, spend, CAC ni ROAS
- **Closer llega al resultado comercial pero no a la atribución**
- El alcance de lectura se traduce a un **WHERE en la consulta, no a un filtro en memoria**

### El alcance Evergreen / Lanzamiento

`ScopeMode` = `'all' | 'evergreen' | 'launch'`, guardado en la cookie `crm_scope`
(1 año), así cada persona tiene la suya.

- `'all'` devuelve `launchIds: null` **a propósito**: así la consulta no añade ningún WHERE
- Lista vacía de lanzamientos → se inyecta el UUID centinela `00000000-…-000000000000` para forzar resultado vacío. **Ver mina 4.4**

### `labels.ts` — la única frontera idioma↔BD

Cambiar una etiqueta en pantalla no puede romper datos históricos ni consultas.
Un código desconocido devuelve **el código crudo**, no un guion: *«preferimos ver
`weird_status` en pantalla a esconder un dato que no esperábamos»*.

---

## 13. Qué ve cada rol

| Rol | Home | Pantallas |
|---|---|---|
| **Propietario** | `/owner` | Panel (embudo, KPIs, alertas), Leads (8 filtros + paginación), ficha de lead (6 pestañas), Tareas, Facturación, Equipo |
| **Setter** | `/setter/mi-trabajo` | Su cola del día, Mis leads, Mis tareas, ficha de llamada |
| **Closer** | `/closer/reuniones` | Sus reuniones, Mis leads, ficha de reunión con formulario de resultado |

**Ficha de lead — 6 pestañas:** Datos · Formularios · Llamadas · Reuniones ·
Actividad · Pendientes.

**Filtros de la lista de leads:** todos, nuevos, cualificados, con reunión,
seguimiento, ganados, perdidos, sin próxima acción, no contactables.

**El equipo real en la base de datos** (5 personas, todas `@kaptaviral.com`):

| Nombre | Rol |
|---|---|
| Álvar Sola | Propietario |
| Eyuel | Propietario |
| Ryan | Propietario |
| Darío | Closer |
| Ángel | Setter |

⚠️ El `README.md` dice *«Álvar (Propietario + Setter), Ryan (Propietario + Setter)
o Iwelo (Closer)»*. **Es incorrecto.** No existe ningún usuario llamado Iwelo: es
un alias en el código del seed (`const iwelo = dario`). Y nadie tiene dos roles,
pese a que la spec justifica `user_roles` diciendo que «Álvar es Owner Y Setter».

---

## 14. Los datos de prueba

`src/db/seed.ts` es **determinista**: `rngState` arranca en 42 y se resetea en
cada ejecución, así que el mismo seed produce siempre los mismos datos.

- **78 leads**: 60 del lanzamiento *Faceless · Septiembre 2026* (`type='launch'`, ticket 300000) + 18 de *Kapta Viral · Evergreen* (`channel='instagram_dm'`)
- Contraseña inicial común: **`CambiarEsto2026!`**, pensada para cambiarse el primer día
- Cascada del lanzamiento: 15 % orgánico / 85 % Meta → 85 % rellena perfil → 68 % contesta la llamada #1 → de esos, 62 % cualifica
- Resultados de reunión pasada: 14 % no-show · 20 % ganada · 28 % seguimiento · 23 % perdida · 15 % pendiente
- 45 % de las ventas financiadas (proveedor «Sequra», 3 o 6 plazos). **El resto del redondeo se acumula en la última cuota**: las cuotas tienen que sumar exactamente el importe
- Al final hace `setval('lead_public_seq', …)` — si la secuencia no queda por delante de los datos, el siguiente alta real colisiona

### `npm run verify` — las 21 comprobaciones

Levanta un **Postgres de verdad en memoria** (PGlite), aplica la migración e
`init.sql`, y comprueba que las promesas del proyecto se cumplen. La pieza
central es **`mustReject`**: espera que la consulta **falle**, y si pasa reporta
que *«la base de datos ACEPTÓ un dato que debería rechazar»*.

Verifica, entre otras: que un webhook repetido de Calendly no duplica la cita,
que el doble clic en «Ganado» no crea dos ventas, y que `webinar_attended` nace
`NULL` y no `false`.

**No hay ninguna otra prueba en el repositorio.** No existe suite de tests.

---

## 15. ⚠️ Incoherencias confirmadas en el código

Verificadas leyendo el código, no supuestas. **No son opiniones de estilo: son
cosas que no hacen lo que parece que hacen.**

### 15.1 La decisión #12 de la spec NO está implementada

La spec dice: *cancelación válida = con ≥2 h de margen; con menos, cuenta como
no-show*. **No existe esa lógica.** `cancelMeeting` siempre escribe `cancelled`
sin mirar la hora, y el show rate solo suma `held + no_show`, así que una
cancelación a 10 minutos vista **desaparece del denominador** en lugar de contar
como no-show — que es exactamente lo contrario de lo que se decidió.

La clave `cancellation_grace_hours = {hours: 2}` **se siembra en
`automation_settings` y no la lee nadie**.

### 15.2 `/perfil/{token}` no existe

`POST /api/public/lead` responde con `profile_url = '/perfil/<token>'`, pero **no
hay ninguna ruta `/perfil` en la aplicación**. Y como completar el formulario
`PRECLASS_PROFILE` es lo único que pone `eligible_for_setter = true`, hoy **no
hay ningún camino dentro del CRM que llene la cola del setter**: tiene que
hacerlo un formulario externo llamando a la API.

### 15.3 La alerta de duplicados enlaza a un filtro inexistente

`needsAttention` genera `href='/owner/leads?filtro=duplicados'`, pero ese caso no
existe en el `switch` de `listLeads` ni en los chips de la página. El enlace cae
en el `default` y **muestra todos los leads sin filtrar, sin dar error**.

`lead_merge_candidates` solo se escribe y se cuenta. **No hay ninguna pantalla,
acción ni función que resuelva un duplicado** ni que escriba `merged_into_lead_id`.

### 15.4 `capture.js` captura last-touch y el CRM lo tira

El snippet guarda un `last_touch` separado y lo envía; la ruta pública lo parsea
y lo pasa al dominio; pero **`createLeadFromForm` solo inserta `touch: 'first'`**.
La atribución de último toque no llega a la base de datos, pese a que
`lead_attribution` tiene el `unique(lead_id, touch)` preparado para dos filas.

### 15.5 Un reembolso desconocido lanza excepción

En `external-sales.ts:94-97`, el comentario dice *«Se ignora, pero el webhook
queda registrado»* y la línea siguiente es un `throw`. Un webhook de reembolso de
una transacción que el CRM nunca vio **devuelve error al proveedor**, con el
reintento que eso implica.

### 15.6 Código muerto y cabos sueltos

- **`assertManualTransition` no tiene ni un solo llamador.** No existe ninguna vía de cambio manual de estado con motivo auditado
- **`RetryPolicy.second_retry_strategy` nunca se lee**: `computeRetryAt` solo distingue `attempt === 2` del resto
- **`bookMeeting`** busca el duplicado con `externalProvider ?? 'calendly'` pero **inserta** `externalProvider ?? null`: una reserva sin provider explícito no la encontrará la siguiente comprobación de idempotencia
- **El margen de 2 h aparece dos veces como constante escrita a mano** en ficheros distintos (`metrics.ts:314` y `automation.ts:210`), sin constante compartida
- **La alerta `DUPLICATES_PENDING` ignora el filtro de alcance**: es la única que no aplica `inScope`, así que el número de duplicados no cambia al cambiar de lanzamiento

---

## 16. Lo que NO existe (y no es un bug)

Deliberadamente fuera del V0:

- ❌ **Transcripciones de reuniones y diagnóstico por IA.** Se retiraron del alcance a petición del cliente. Queda `meetings.phantom_url` (un enlace a la grabación) pero **no hay integración ni herramienta identificada detrás de «Phantom»**
- ❌ Sincronización con Meta y envío de CAPI
- ❌ Informes generados por IA
- ❌ Calendario global, exportaciones, notificaciones
- ❌ Pantalla de resolución de duplicados
- ❌ Cambio manual de estado con auditoría
- ❌ Multi-cliente. Existe `launch_id` desde la primera tabla, pero el alcance es solo Álvar

---

## 17. Preguntas abiertas — para el cliente

Ninguna se puede resolver leyendo el código.

1. **¿Quién llama a `POST /api/public/lead`?** `capture.js` solo rellena un input oculto; no hace `fetch`. Y el endpoint exige la cabecera `x-crm-token`, que un formulario HTML normal no puede enviar
2. **¿Dónde vive el formulario de perfil?** Es lo único que abre la cola del setter, y la ruta que devuelve la API no existe
3. **¿Qué se hace con un duplicado detectado?** ¿Trabajo pendiente, o se resuelve a mano en SQL?
4. **¿Quién puede cambiar el estado de un lead a mano, y dónde queda auditado?**
5. **¿Qué es «Phantom»?**
6. **¿Cuál es el proveedor de financiación real?** El seed usa «Sequra». La venta desde reunión genera N cuotas; la venta externa genera una sola. Nadie ha decidido qué pasa con una venta de Hotmart a plazos
7. **¿Está dado de alta el webhook de Calendly?** Su clave de firma está vacía en producción
8. **¿Hay que rotar los secretos** que están en claro en el directorio de trabajo, y quién lo hace?

---

## 18. Operación

### Despliegue (pendiente de completar)

1. Neon: base creada ✅ — copiar la *pooled connection string*
2. **Netlify: conectar el repositorio desde el panel** ← 🔴 bloqueante actual
3. Variables de entorno en Netlify (las 7, ya creadas pero **no marcadas como secretas**)
4. Aplicar el esquema: `DATABASE_URL=… npm run db:push` y después `npm run db:init`. **Nunca `db:seed` contra producción**
5. Dominio: `CNAME  crm → <sitio>.netlify.app`
6. Cron: secretos `CRM_URL` y `CRON_SECRET` en GitHub ✅ ya configurados
7. `DEV_AUTH=false` en producción
8. **`landing/capture.js` en la landing ANTES del primer euro de ads**

### Variables de entorno

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres. Vacía → PGlite embebido |
| `SESSION_SECRET` | Firma las cookies. **Obligatoria**, mín. 32 car. `openssl rand -base64 48` |
| `DEV_AUTH` | Selector de usuario sin contraseña. Se apaga solo en producción |
| `PUBLIC_FORM_TOKEN` | Cabecera `x-crm-token` del endpoint público |
| `CRON_SECRET` | Bearer de `/api/cron` |
| `HOTMART_WEBHOOK_TOKEN` | Cabecera del webhook de Hotmart |
| `MANYCHAT_WEBHOOK_TOKEN` | Cabecera del webhook de ManyChat |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | Firma HMAC de Calendly. **Vacía hoy** |

### `landing/capture.js` — la pieza urgente

Es independiente del CRM y **se puede desplegar hoy**. Captura la atribución de
primer toque; **si los ads arrancan antes, esa atribución se pierde para siempre**.

- La primera atribución **no se sobrescribe nunca**
- El last-touch solo se guarda si la visita trae parámetros publicitarios reales
- Lee las cookies `_fbp` y `_fbc` de Meta, necesarias para deduplicar conversiones server-side. Si no hay `_fbc` pero la URL trae `fbclid`, lo sintetiza
- **La IP nunca la manda el cliente**: la resuelve el backend
- Los formularios embebidos (Tally, Typeform) cargan tarde, así que la inyección se reintenta en `DOMContentLoaded`, en captura del `submit`, y con timeouts a 1500 y 4000 ms

### Cabeceras y caché

`/api/*` va con `Cache-Control: no-store`: si una capa de caché responde por el
servidor, la comprobación del token nunca se ejecuta. El CRM es interno, así que
todo `/*` lleva `noindex, nofollow`, `X-Frame-Options: DENY` y `nosniff`.

---

## 19. Modelo económico

**Reparto mensual** (implementado en `contabilidad/`, no en el CRM):

1. Ventas del mes
2. − Costes de software (Calendly, Zapier, ManyChat), convertidos a euros
3. = **Base tras software**
4. − Comisión del **setter: 6 %** sobre esa base
5. − Comisión del **closer: 10 %** sobre el importe **ya descontada la del setter** ← **las comisiones son en cascada**
6. = Neto a repartir → **Álvar 65 % / Equipo 35 %**

El cierre de agosto de 2026 está en `contabilidad/`, en HTML editable y PDF.
Hay dos versiones: la completa y una **para el closer** que oculta el reparto y
la comisión del setter.

---

## 20. Mapa de ficheros

| Ruta | Qué es |
|---|---|
| `CONTEXTO.md` | Este documento |
| `README.md` | Portada del repo, con el enlace a la demo |
| `app/README.md` | Puesta en marcha. **Tiene 3 datos caducados** (equipo, auth, `db:seed`) |
| `app/src/db/schema.ts` | Las 29 tablas |
| `app/src/db/init.sql` | Secuencia + 7 CHECK que Drizzle no genera |
| `app/src/db/seed.ts` | 78 leads deterministas. **TRUNCA la base** |
| `app/src/domain/` | Toda la regla de negocio |
| `app/src/lib/` | Auth, permisos, alcance, formato |
| `app/scripts/verify-schema.ts` | Las 21 comprobaciones |
| `spec/00-DECISIONES-CERRADAS.md` | Las 14 contradicciones resueltas. **Stack obsoleto** |
| `spec/01-PLAN-4-SEMANAS.md` | Plan de construcción y fechas límite escalonadas |
| `spec/02-SCHEMA-V0.sql` | DDL de referencia (30 tablas: una de más) |
| `landing/capture.js` | Atribución de primer toque. **Desplegar antes de los ads** |
| `contabilidad/` | Cierre mensual, HTML + PDF |
| `docs/` | **Salida generada.** 511 páginas HTML estáticas de la demo. No es código fuente: no editar a mano |
| `PROMPT-BASE44.md` | Prompt para reconstruir el sistema en Base44. Buen resumen independiente de las reglas de negocio |
| `netlify.toml` | `base = "app"`, sin `publish` a propósito |
| `.github/workflows/cron.yml` | Cron cada 10 min |

---

## 21. Si vas a tocar algo

- **Regla de negocio** → va en `domain/`, nunca en una página ni en un webhook
- **Cambio de schema** → `schema.ts` **y** `spec/02-SCHEMA-V0.sql`, después `npm run db:generate` y `npm run verify`
- **Nuevo estado** → añádelo a `STATUS_RANK` **y** al CHECK de `init.sql`, o la base lo rechazará
- **Nueva métrica** → en `metrics.ts`, con el denominador en el nombre
- **Nueva etiqueta visible** → en `labels.ts`, nunca en el JSX
- **Color** → solo si comunica estado, riesgo o prioridad. *«Si algo es verde es porque va bien, no porque quede bonito»*
