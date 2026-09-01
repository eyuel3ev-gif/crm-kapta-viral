# Prompt para Base44 · CRM comercial Kapta Viral

> Pega todo lo que hay debajo de la línea en el chat del agente de Base44.
> Está escrito para que lo construya de una vez, no por partes.

---

Construye un CRM comercial completo. Es el sistema operativo de ventas de una
agencia que vende un programa de formación de alto ticket. Lo usan cinco
personas. No es un CRM genérico: cada regla de abajo existe porque sin ella
los números salen mal.

## Contexto del negocio

Dos negocios conviven en el mismo CRM y hay que poder verlos por separado:

- **Evergreen** — siempre abierto. La gente escribe por DM de Instagram, un
  setter conversa, y compran directamente en Hotmart. Ticket ~1.497 €. No hay
  clases ni reuniones.
- **Lanzamiento** — tiene calendario. Anuncios → landing → formulario → grupo
  de WhatsApp → 3 clases → directo → Calendly → reunión comercial con un
  closer. Ticket ~3.000 €.

Mezclar sus métricas miente en las dos direcciones: un evergreen que vende
todo el mes hunde el close rate de un lanzamiento de tres días.

## Equipo y roles

| Persona | Rol |
|---|---|
| Álvar Sola | Propietario |
| Eyuel | Propietario |
| Ryan | Propietario |
| Darío | Closer |
| Ángel | Setter |

Una persona puede tener varios roles a la vez. Cada rol ve una aplicación
distinta, no la misma con botones ocultos.

---

# 1 · ENTIDADES

Crea estas entidades. Los `enum` son cerrados a propósito: el texto libre no
se puede agregar después y hace imposible cualquier análisis.

## Launch

```jsonc
{
  "name": "Launch",
  "type": "object",
  "properties": {
    "nombre": { "type": "string", "description": "Nombre del negocio" },
    "tipo": {
      "type": "string",
      "enum": ["evergreen", "lanzamiento"],
      "default": "lanzamiento",
      "description": "Evergreen no tiene clases ni reuniones"
    },
    "estado": {
      "type": "string",
      "enum": ["borrador", "activo", "cerrado"],
      "default": "activo"
    },
    "ticket_cents": { "type": "number", "description": "Precio en céntimos" },
    "moneda": { "type": "string", "default": "EUR" },
    "clase_1_at": { "type": "string", "format": "date-time" },
    "clase_2_at": { "type": "string", "format": "date-time" },
    "clase_3_at": { "type": "string", "format": "date-time" },
    "directo_at": { "type": "string", "format": "date-time" }
  },
  "required": ["nombre", "tipo"]
}
```

## Lead

```jsonc
{
  "name": "Lead",
  "type": "object",
  "properties": {
    "public_id": { "type": "string", "description": "LD-000184, correlativo" },
    "launch_id": { "type": "string", "description": "A qué negocio pertenece" },
    "nombre": { "type": "string" },
    "telefono_raw": { "type": "string", "description": "Tal como lo escribió" },
    "telefono": { "type": "string", "description": "Normalizado E.164: +34612345678" },
    "email": { "type": "string", "description": "Minúsculas, sin espacios" },
    "ciudad": { "type": "string" },

    "canal": {
      "type": "string",
      "enum": ["formulario", "instagram_dm", "manual"],
      "default": "formulario"
    },
    "instagram_handle": { "type": "string" },
    "manychat_contact_id": { "type": "string", "description": "Identidad única del suscriptor" },
    "conversacion_url": { "type": "string", "description": "Enlace directo al chat" },

    "estado": {
      "type": "string",
      "enum": ["nuevo", "contactado", "cualificado", "descartado",
               "reunion_agendada", "reunion_realizada", "seguimiento",
               "ganado", "perdido"],
      "default": "nuevo",
      "description": "Estado COMERCIAL, la dimensión del embudo"
    },
    "estado_contacto": {
      "type": "string",
      "enum": ["sin_intentar", "intentado", "contactado", "no_contactable"],
      "default": "sin_intentar",
      "description": "¿He podido hablar con él? Separado a propósito del estado"
    },
    "estado_cualificacion": {
      "type": "string",
      "enum": ["sin_evaluar", "cualificado", "no_cualificado"],
      "default": "sin_evaluar",
      "description": "¿Es buen lead? NUNCA se deduce de no coger el teléfono"
    },
    "nivel_interes": { "type": "string", "enum": ["bajo", "medio", "alto", "muy_alto"] },
    "confirmacion_directo": {
      "type": "string",
      "enum": ["confirmado", "probable", "dudoso", "no_puede", "no_contesta"]
    },
    "asistio_directo": {
      "type": "boolean",
      "description": "DEJAR VACÍO si el acceso es un enlace genérico de Zoom. Vacío significa que no lo sabemos, y eso NO es lo mismo que false"
    },

    "elegible_setter": { "type": "boolean", "default": false },
    "setter_email": { "type": "string" },
    "closer_email": { "type": "string" },
    "proxima_accion": { "type": "string" },
    "proxima_accion_at": { "type": "string", "format": "date-time" },

    "revenue_cents": {
      "type": "number",
      "default": 0,
      "description": "DERIVADO: se recalcula sumando las Sale activas. Nunca se escribe a mano"
    },

    "fuente": {
      "type": "string",
      "enum": ["meta", "organico", "referido", "hotmart", "directo", "desconocido"],
      "default": "desconocido"
    },
    "campaign_id": { "type": "string" },
    "campaign_name": { "type": "string", "description": "Snapshot: en Meta el nombre cambia" },
    "adset_id": { "type": "string" },
    "ad_id": { "type": "string" },
    "ad_name": { "type": "string" },
    "utm_source": { "type": "string" },
    "utm_campaign": { "type": "string" },
    "utm_content": { "type": "string" },
    "fbclid": { "type": "string" },
    "fbp": { "type": "string", "description": "Necesario para enviar conversiones a Meta" },
    "fbc": { "type": "string" },
    "landing_url": { "type": "string" },

    "situacion_actual": { "type": "string" },
    "experiencia": { "type": "string" },
    "objetivo": { "type": "string" },
    "bloqueo": { "type": "string" },
    "tiempo_semanal": { "type": "string" },

    "registrado_at": { "type": "string", "format": "date-time" },
    "cualificado_at": { "type": "string", "format": "date-time" },
    "ganado_at": { "type": "string", "format": "date-time" },
    "perdido_at": { "type": "string", "format": "date-time" }
  },
  "required": ["nombre", "launch_id"]
}
```

## SetterCall

```jsonc
{
  "name": "SetterCall",
  "type": "object",
  "properties": {
    "lead_id": { "type": "string" },
    "setter_email": { "type": "string" },
    "launch_id": { "type": "string" },
    "tipo": {
      "type": "string",
      "enum": ["cualificacion", "confirmar_directo", "confirmacion_24h"],
      "description": "cualificacion = tras la Clase 1"
    },
    "grupo_id": {
      "type": "string",
      "description": "CLAVE: agrupa los reintentos de la MISMA llamada lógica. Sin esto, 3 intentos al mismo lead cuentan como 3 leads en el contact rate"
    },
    "intento": { "type": "number", "default": 1 },
    "meeting_id": { "type": "string" },
    "programada_at": { "type": "string", "format": "date-time" },
    "completada_at": { "type": "string", "format": "date-time" },
    "estado": {
      "type": "string",
      "enum": ["programada", "completada", "cancelada"],
      "default": "programada"
    },
    "contesto": { "type": "boolean", "description": "Vacío = todavía sin ejecutar" },
    "resultado": {
      "type": "string",
      "enum": ["contesto", "no_contesta", "numero_erroneo", "llamar_despues"]
    },
    "nivel_interes": { "type": "string", "enum": ["bajo", "medio", "alto", "muy_alto"] },
    "cualificacion": { "type": "string", "enum": ["cualificado", "no_cualificado"] },
    "motivo_descarte": {
      "type": "string",
      "enum": ["sin_interes_real", "sin_tiempo", "solo_info_gratis",
               "perfil_no_encaja", "objetivo_incompatible", "no_quiere_implementar", "otro"]
    },
    "intencion_asistencia": {
      "type": "string",
      "enum": ["confirmado", "probable", "dudoso", "no_puede", "no_contesta"]
    },
    "confirmacion_reunion": {
      "type": "string",
      "enum": ["confirmada", "pide_reagendar", "cancela", "dudoso", "no_contesta"]
    },
    "respuestas": { "type": "object", "description": "pregunta → respuesta" },
    "notas": { "type": "string" }
  },
  "required": ["lead_id", "tipo", "grupo_id"]
}
```

## Meeting

```jsonc
{
  "name": "Meeting",
  "type": "object",
  "properties": {
    "lead_id": { "type": "string" },
    "closer_email": { "type": "string" },
    "launch_id": { "type": "string" },
    "numero": {
      "type": "number",
      "default": 1,
      "description": "Meeting #2 NUNCA sobrescribe la #1. Cada una guarda sus notas y su resultado"
    },
    "calendly_booking_id": {
      "type": "string",
      "description": "Clave de idempotencia: Calendly reenvía el mismo evento"
    },
    "programada_at": { "type": "string", "format": "date-time" },
    "terminada_at": { "type": "string", "format": "date-time" },

    "estado": {
      "type": "string",
      "enum": ["programada", "realizada", "no_show", "cancelada"],
      "default": "programada",
      "description": "Estado OPERATIVO de la cita"
    },
    "resultado_comercial": {
      "type": "string",
      "enum": ["pendiente", "ganado", "perdido", "seguimiento"],
      "default": "pendiente",
      "description": "SEPARADO del estado: una reunión puede estar realizada con resultado seguimiento"
    },
    "confirmacion_24h": {
      "type": "string",
      "enum": ["pendiente", "confirmada", "pide_reagendar", "cancelada", "dudoso", "no_contesta"],
      "default": "pendiente"
    },

    "notas": { "type": "string", "description": "Internas del closer" },
    "grabacion_url": { "type": "string" },

    "motivo_perdida": {
      "type": "string",
      "enum": ["precio", "financiacion_rechazada", "sin_tiempo", "no_confia",
               "no_prioridad", "debe_consultarlo", "no_cualificado",
               "competencia", "no_encaja", "otro"]
    },
    "motivo_perdida_notas": { "type": "string" },
    "motivo_seguimiento": { "type": "string" },
    "seguimiento_at": { "type": "string", "format": "date-time" },
    "proxima_accion": { "type": "string" },
    "reagendada_desde": { "type": "string", "format": "date-time" }
  },
  "required": ["lead_id", "numero", "programada_at"]
}
```

## Sale

```jsonc
{
  "name": "Sale",
  "type": "object",
  "properties": {
    "lead_id": { "type": "string" },
    "meeting_id": { "type": "string", "description": "VACÍO si es compra directa en Hotmart" },
    "closer_email": { "type": "string", "description": "VACÍO si no hubo reunión" },
    "launch_id": { "type": "string" },
    "origen": {
      "type": "string",
      "enum": ["reunion", "hotmart", "manual"],
      "default": "reunion"
    },
    "transaccion_externa": {
      "type": "string",
      "description": "Id de Hotmart. ÚNICO: la misma compra no puede entrar dos veces"
    },
    "importe_cents": { "type": "number", "description": "SIEMPRE céntimos enteros, nunca decimales" },
    "moneda": { "type": "string", "default": "EUR" },
    "metodo_pago": {
      "type": "string",
      "enum": ["tarjeta", "transferencia", "financiacion", "hotmart", "otro"]
    },
    "estado_financiacion": {
      "type": "string",
      "enum": ["no_aplica", "no_solicitada", "solicitada", "aprobada", "rechazada", "pendiente"],
      "default": "no_aplica",
      "description": "Estado explícito, no un sí/no: solicitada y rechazada son cosas muy distintas"
    },
    "proveedor_financiacion": { "type": "string" },
    "cuotas": { "type": "number" },
    "estado": {
      "type": "string",
      "enum": ["activa", "reembolsada", "impagada", "corregida", "cancelada"],
      "default": "activa"
    },
    "cerrada_at": { "type": "string", "format": "date-time" },
    "producto": { "type": "string" }
  },
  "required": ["lead_id", "importe_cents", "cerrada_at"]
}
```

## Payment

```jsonc
{
  "name": "Payment",
  "type": "object",
  "properties": {
    "sale_id": { "type": "string" },
    "importe_cents": { "type": "number" },
    "moneda": { "type": "string", "default": "EUR" },
    "estado": {
      "type": "string",
      "enum": ["pendiente", "pagado", "fallido", "reembolsado"],
      "default": "pendiente"
    },
    "vence_at": { "type": "string", "format": "date-time" },
    "pagado_at": { "type": "string", "format": "date-time" },
    "numero_cuota": { "type": "number" },
    "referencia_externa": { "type": "string" }
  },
  "required": ["sale_id", "importe_cents"]
}
```

**Por qué existe esta entidad:** con ticket de 3.000 € y financiación, el
impago no es un caso raro. Sin ella, el revenue miente desde el mes dos.
*Revenue contratado* (lo vendido) y *cash collected* (lo cobrado) son cifras
distintas y hay que mostrarlas por separado.

## Task

```jsonc
{
  "name": "Task",
  "type": "object",
  "properties": {
    "titulo": { "type": "string" },
    "motivo": {
      "type": "string",
      "description": "POR QUÉ existe esta tarea. Una tarea automática sin motivo es ruido y el equipo aprende a ignorarla"
    },
    "tipo": {
      "type": "string",
      "enum": ["llamada_1", "reintento_llamada", "confirmar_directo",
               "confirmacion_24h", "registrar_resultado", "seguimiento",
               "conversacion_instagram", "recuperar_no_show", "manual"]
    },
    "origen": { "type": "string", "enum": ["manual", "automatica"], "default": "manual" },
    "clave_unica": {
      "type": "string",
      "description": "CLAVE: impide que el cron cada 10 min genere 100 tareas idénticas. Ejemplo: confirmacion_24h:{meeting_id}"
    },
    "estado": {
      "type": "string",
      "enum": ["pendiente", "en_proceso", "completada", "cancelada"],
      "default": "pendiente",
      "description": "\"Vencida\" NO es un estado: se calcula comparando vence_at con ahora"
    },
    "prioridad": {
      "type": "string",
      "enum": ["baja", "media", "alta", "critica"],
      "default": "media"
    },
    "asignada_a": { "type": "string", "description": "Email" },
    "lead_id": { "type": "string" },
    "meeting_id": { "type": "string" },
    "setter_call_id": { "type": "string" },
    "launch_id": { "type": "string" },
    "vence_at": { "type": "string", "format": "date-time" },
    "completada_at": { "type": "string", "format": "date-time" },
    "completada_por": { "type": "string" }
  },
  "required": ["titulo", "tipo"]
}
```

## Activity

```jsonc
{
  "name": "Activity",
  "type": "object",
  "properties": {
    "lead_id": { "type": "string" },
    "tipo": { "type": "string", "description": "LEAD_CREADO, LLAMADA_NO_CONTESTA, VENTA_CREADA…" },
    "titulo": { "type": "string" },
    "descripcion": { "type": "string" },
    "actor": { "type": "string", "enum": ["usuario", "sistema", "integracion"], "default": "sistema" },
    "actor_email": { "type": "string" },
    "ocurrio_at": { "type": "string", "format": "date-time" }
  },
  "required": ["lead_id", "tipo", "titulo"]
}
```

Se alimenta **sola**. Nadie escribe aquí a mano. Es la historia legible del
lead: quién lo tocó, cuándo y qué pasó.

## WebhookEvent

```jsonc
{
  "name": "WebhookEvent",
  "type": "object",
  "properties": {
    "proveedor": { "type": "string", "enum": ["hotmart", "manychat", "calendly", "formulario"] },
    "evento_externo_id": { "type": "string", "description": "ÚNICO por proveedor" },
    "tipo_evento": { "type": "string" },
    "payload": { "type": "object" },
    "estado": {
      "type": "string",
      "enum": ["recibido", "procesando", "procesado", "fallido"],
      "default": "recibido"
    },
    "error": { "type": "string" }
  },
  "required": ["proveedor", "evento_externo_id"]
}
```

Sin esta entidad no hay idempotencia y un webhook reenviado duplica ventas.

---

# 2 · FUNCIONES DE BACKEND

Cuatro funciones invocables por HTTP. Todas comprueban un token en la
cabecera `x-crm-token` antes de nada; sin token, 401.

## `webhook-hotmart`

Recibe compras desde Zapier. **Vocabulario real de Hotmart** — llegan como
`PURCHASE_APPROVED`, no como `approved`:

| Evento | Qué hacer |
|---|---|
| `PURCHASE_APPROVED`, `PURCHASE_COMPLETE` | Crear la venta |
| `PURCHASE_REFUNDED` | Marcar la venta `reembolsada` |
| `PURCHASE_CHARGEBACK` | Marcar la venta `impagada` |
| `PURCHASE_CANCELED`, `PURCHASE_EXPIRED` | Marcar `cancelada` |
| `PURCHASE_PROTEST`, `PURCHASE_DELAYED`, `PURCHASE_BILLET_PRINTED` | **Acusar recibo y NO tocar la contabilidad** |

Los tres últimos son importantes: una disputa abierta no es dinero devuelto,
un recibo vencido no anula la venta, y emitir un boleto no es haber cobrado.
Revertir por cualquiera de ellos descuadra el mes por algo que aún puede
resolverse a favor.

Lógica:
1. Si ya existe una `Sale` con esa `transaccion_externa`, devolver OK sin
   hacer nada. **Nunca duplicar.**
2. Buscar al comprador entre los leads existentes por **teléfono normalizado
   exacto**, luego por **email exacto**. Si aparece, la venta cuelga de SU
   ficha — puede haber comprado tras una reunión.
3. Si no aparece, crear un lead nuevo en el negocio **Evergreen**.
4. La venta hereda el `launch_id` **del lead**, no el de por defecto. Si
   compró tras una reunión del lanzamiento, no puede contabilizarse como
   Evergreen.
5. Crear `Payment` en estado `pagado`.
6. Recalcular `revenue_cents` del lead sumando sus ventas activas.
7. Escribir en `Activity`.

Importes: aceptar `"2.997,00"` (formato español), `"2997.00"` y `299700`.

## `webhook-manychat`

Recibe conversaciones de Instagram.

**El CRM NO duplica la bandeja de entrada.** Guarda el contacto, lo asigna a
un setter, le abre la tarea, y el setter responde en Instagram con un enlace
directo. Replicar los mensajes exigiría la Instagram Messaging API con
revisión de app, y daría una bandeja peor que la de Instagram.

1. Si ya existe un lead con ese `manychat_contact_id`, actualizar huecos y
   añadir el mensaje a `Activity`. **No crear otro lead.**
2. Si no, crear lead con `canal: instagram_dm`, en el negocio **Evergreen**,
   `estado_contacto: contactado`, `elegible_setter: true`.
3. Asignar setter por turno rotatorio entre los setters activos.
4. Crear `Task` tipo `conversacion_instagram` con
   `clave_unica: ig:{manychat_contact_id}`.

## `webhook-calendly`

1. Idempotencia por `calendly_booking_id`. Reenvíos no duplican citas.
2. Matching **conservador**: teléfono exacto → email exacto. **Jamás fusionar
   dos personas por parecido de nombre.** Si no hay match seguro, crear lead
   marcado para revisión manual: un duplicado revisable es mucho mejor que
   dos personas mezcladas.
3. Numerar la reunión por lead: 1, 2, 3… **La #2 no toca la #1.**
4. Reagendar: **mover la fecha de la reunión existente**, no crear otra.
   Crear una segunda inflaría el show rate contando dos citas donde hubo una.
   Cancelar las tareas de confirmación obsoletas y generar la nueva.

## `cron-automatizaciones`

La llama GitHub Actions cada 10 minutos. Todas las reglas son
**idempotentes**: ejecutarla 144 veces al día produce las mismas tareas que
ejecutarla una, porque cada tarea lleva su `clave_unica`.

| Regla | Condición | Acción |
|---|---|---|
| Llamada de cualificación | Solo negocios **lanzamiento**, X horas tras Clase 1, lead elegible sin contactar | Crear `SetterCall` + `Task` |
| Confirmar directo | Solo **lanzamiento**, entre 30 h y 4 h antes, leads cualificados con interés medio o superior | Crear llamada tipo `confirmar_directo` |
| Confirmación 24 h | Reunión entre 23 h y 25 h vista, sin confirmar | `Task` crítica, `clave_unica: confirmacion_24h:{meeting_id}` |
| Reunión sin resultado | Pasó hace más de 2 h y sigue `pendiente` | `Task` crítica al closer |
| Cualificado sin acción | Cualificado, sin `proxima_accion_at`, sin tareas abiertas | `Task` al setter |

Las dos primeras **solo aplican a lanzamiento**: en Evergreen no hay Clase 1
ni directo, y crear esas tareas sería pedirle al equipo que actúe sobre algo
que no existe.

---

# 3 · REGLAS QUE NO SE PUEDEN ROMPER

Cada una está aquí porque su ausencia rompe algo concreto.

**Dinero en céntimos enteros.** Nunca decimales. `0.1 + 0.2 !== 0.3`, y en una
columna de revenue eso acaba en un descuadre que nadie sabe explicar.

**Vacío ≠ falso ≠ cero.** Vacío significa «no lo sabemos». Si el acceso al
directo es un enlace genérico de Zoom, `asistio_directo` se queda **vacío**.
Poner `false` es inventarse un dato y contamina todo el análisis.

**No contestar no descalifica.** `estado_contacto` y `estado_cualificacion`
son dos preguntas distintas: «¿he podido hablar con él?» y «¿es buen lead?».
Tras 3 intentos sin respuesta el lead queda `no_contactable` y
`sin_evaluar` — nunca `no_cualificado`. Mezclarlas hace imposible saber si el
tráfico es malo o si llamamos a mala hora.

**Estado de reunión ≠ resultado comercial.** Una reunión puede estar
`realizada` con resultado `seguimiento`. Un solo campo no puede decir las dos
cosas.

**Un no-show no es una pérdida.** Es un estado operativo. Se reagenda. Marcarlo
perdido destruye leads recuperables y ensucia el close rate.

**Perder exige motivo del catálogo.** No texto libre. El texto libre no se
agrega, y sin agregar no puedes saber que el precio aparece en el 37 % de las
pérdidas.

**Seguir exige fecha y próxima acción.** Un seguimiento sin fecha es un lead
olvidado con otro nombre. No permitir guardar sin las dos cosas.

**Ganar exige importe y método de pago.**

**Doble click no crea dos ventas.** Clave de idempotencia por venta.

**El revenue del lead se recalcula desde las ventas.** Nunca se acumula ni se
escribe a mano.

**Un evento atrasado no degrada un estado avanzado.** Si llega un
`meeting.booked` viejo sobre un lead ya `ganado`, entra al historial pero
**no** cambia el estado actual. Es el fallo que rompe los paneles en silencio
a las tres semanas.

**Los permisos se comprueban en el servidor.** Esconder un botón no es un
permiso. Un setter no puede ver facturación aunque escriba la URL.

---

# 4 · INTERFACES POR ROL

Base visual: **negro, gris y blanco**. El color solo comunica estado, riesgo
o prioridad — nunca decora. Verde = bien, rojo = riesgo, naranja = atención,
azul = información. Números tabulares y alineados a la derecha. Interfaz en
español; los valores internos en inglés o snake_case.

## Propietario

Selector permanente arriba: **Todo / Evergreen / Lanzamiento**. Cambia el
significado de todos los números a la vez, así que tiene que verse sin
buscarlo.

**Inicio** — Leads, Cualificados, Reuniones, Ventas, Revenue. Debajo: contact
rate, cualificación, show rate, close rate, ticket medio. Cada ratio con su
denominador escrito (*«ventas / reuniones realizadas»*). Divisor cero muestra
**«—»**, nunca 0 ni infinito. Con menos de 10 reuniones, avisar de que la
muestra es pequeña.

*Embudo:* Leads → Contactados → Cualificados → Reuniones agendadas →
Realizadas → Ventas. **En Evergreen no hay reuniones**: el embudo pasa de
Cualificados directo a Ventas. Pintar «Reuniones 0 → Ventas 9» dibuja una
resurrección imposible.

Marcar la etapa donde más gente se cae **en términos absolutos**, no la de
peor porcentaje: eso es lo que se puede recuperar.

*Requiere atención:* reuniones sin confirmar, reuniones sin resultado,
cualificados sin próxima acción, seguimientos vencidos, duplicados por
revisar. Cada alerta con explicación y enlace. **Filtradas por el negocio
seleccionado.**

**Leads** — tabla con filtros rápidos y búsqueda por nombre, teléfono, email
o `public_id`.

**Ficha de lead** — pestañas: Datos, Formularios, Llamadas, Reuniones,
Actividad, Pendientes. La atribución es de solo lectura.

**Tareas** — con columna de motivo y distinguiendo manual de automática.

**Facturación** — Revenue contratado, Cash collected, Pendiente de cobro,
Reembolsado. Cuotas que vencen. Si lo contratado supera lo cobrado,
explicarlo: son cuotas futuras, no dinero perdido, pero tampoco dinero que
tengas.

**Equipo** — métricas por setter y por closer, **siempre acompañadas del
volumen**. Un 80 % sobre 10 leads no es mejor que un 68 % sobre 140.

## Setter

Solo cuatro pantallas: Mi trabajo, Mis leads, Mis tareas, Calendario. **Nunca
ve revenue, CAC ni ROAS.**

**Mi trabajo** es la pantalla que decide si el CRM sirve. El setter entra y ve
qué hacer, con quién y por qué, **ya ordenado**:

1. Vencidas críticas
2. Confirmaciones de 24 h
3. Reintentos vencidos
4. Llamadas de cualificación
5. Confirmaciones de directo

Cada fila: hora, nombre, tipo de acción, **motivo**, teléfono, y botones
*Llamar* y *Registrar*.

**Formulario de llamada** — preguntas configurables, no escritas en el código.
El botón **«No contesta»** es una acción atómica: guarda el intento, escribe
el historial, evalúa la política de reintentos y crea **una sola** tarea
futura. El setter no crea nada a mano.

Reintentos: 1º sin respuesta → +3 h · 2º → al día siguiente · 3º →
`no_contactable`, y se acabó. **Nunca llamadas infinitas.**

## Closer

**Reuniones** — bloques: Sin resultado registrado (lo primero, porque mientras
falten el show rate y el close rate están mal), Hoy, Próximas, Seguimientos,
No-shows.

**Ficha de reunión** — a la izquierda notas y enlace de grabación con guardado
propio, y el resultado. A la derecha el **handoff del setter**: cualificación,
interés, confirmación de 24 h, y las preguntas que el lead ya contestó. El
closer no debería preguntar dos veces lo mismo.

El formulario de resultado se adapta: *Ganado* pide importe y método de pago;
*Perdido* pide motivo del catálogo; *Seguimiento* pide motivo, fecha y próxima
acción; *No-show* no marca perdido.

---

# 5 · CÓMO SABER QUE ESTÁ BIEN

Comprueba estas doce cosas antes de darlo por terminado:

1. Un formulario crea un lead con `public_id` correlativo
2. Enviar el mismo formulario dos veces crea **un** lead
3. Un webhook de Hotmart repetido no duplica la venta
4. Un comprador que ya era lead engancha la venta a **su** ficha
5. Un reembolso marca la venta y recalcula el revenue
6. Tres «no contesta» dejan `no_contactable` y `sin_evaluar`
7. Ejecutar el cron 20 veces crea **una** tarea de confirmación
8. Reagendar mueve la fecha, no crea una segunda reunión
9. Un no-show no marca el lead perdido
10. Guardar seguimiento sin fecha **falla**
11. Un setter no puede abrir facturación por URL
12. En Evergreen el embudo no muestra etapas de reunión

---

# 6 · DATOS DE PRUEBA

Genera ~60 leads de lanzamiento y ~18 de Evergreen repartidos por **todo** el
embudo, incluyendo los casos raros: no contactables tras 3 intentos,
cualificados sin próxima acción, reuniones pasadas sin resultado,
seguimientos vencidos, no-shows y ventas financiadas a plazos.

Sin volumen y sin casos raros, cada pantalla se prueba vacía y no se ve si
aguanta la realidad. Las tablas que se rompen y los ratios absurdos solo
aparecen con datos que se parecen a los de verdad.
