# Sincronización de inventario con n8n

La fuente operativa del inventario es PostgreSQL del CRM. Google Sheets, un XLSX de Google Drive o un POS son únicamente fuentes de sincronización. Así, el precio y la existencia no se mandan completos al prompt ni se resuelven por RAG.

## Configuración única

1. Define `INVENTORY_SYNC_SECRET` como un valor aleatorio largo en el entorno del CRM y en una credencial de n8n. No lo pongas en un nodo, captura o repositorio.
2. Como Super Admin, abre **Inventario → Configurar fuente**, registra la hoja/archivo y conserva el ID visible en la lista para usarlo como `sourceId` en n8n. La misma operación también está disponible en `POST /api/inventory/sources`.
3. En n8n, añade una credencial **Header Auth** que envíe `Authorization: Bearer <INVENTORY_SYNC_SECRET>` a `https://TU-CRM/api/inventory/sync/*`.

Bearer permite usar el nodo HTTP Request estándar. Para instalaciones que requieren firma de cuerpo, el CRM también acepta HMAC SHA-256: `x-inventory-timestamp` (epoch en ms) y `x-inventory-signature = HMAC(secret, timestamp + "." + body)`; la firma expira en 5 minutos.

## Flujo de Google Sheets

El archivo importable está disponible en `public/examples/n8n-inventario-google-sheets.json` y desde el botón **Workflow de n8n** de Inventario. Incluye disparador manual y `Schedule Trigger` cada hora. Para cambiarlo a 12 o 24 horas, abre el nodo **Cada 1 hora**, cambia **Hours Between Triggers** y vuelve a publicar el workflow.

Para una conciliación completa, lee todas las filas con **Google Sheets → Get Row(s)**. Las columnas recomendadas son:

`SKU, Nombre, Categoria, Descripcion, Marca, Unidad, Precio, Rangos de precio, Existencia, Reservado, Stock minimo, Etiquetas, Ubicacion, Activo, Actualizado en`

Usa **Precio** para un precio fijo. Para precios escalonados deja **Precio** vacío y usa, por ejemplo, `100-150:70|151-200:67|201+:64` en **Rangos de precio**. La plantilla descargable es `public/examples/inventario-ejemplo.csv`.

Secuencia del flujo:

1. `HTTP Request POST /api/inventory/sync/start` con `{ "sourceId": "…", "mode": "full", "idempotencyKey": "sheets-{{$now.toISO()}}" }`.
2. Divide las filas en lotes de máximo 500 (`Loop Over Items` o `Split In Batches`).
3. `HTTP Request POST /api/inventory/sync/batch` con `{ "runId": "{{$node['Start'].json.runId}}", "rows": [ ...lote ] }`.
4. Después del último lote, `HTTP Request POST /api/inventory/sync/finish` con `{ "runId": "…" }`.
5. En la rama de error, llama `/api/inventory/sync/fail` con el mismo `runId` y el mensaje del error.

No ejecutes `finish` si no se pudo leer la hoja: una sincronización completa solo desactiva productos de *esa misma fuente* tras terminar correctamente.

Al finalizar correctamente, un SKU nuevo se crea, un SKU existente actualiza catálogo/precios/rangos/existencias y un SKU retirado de la hoja se desactiva. No se elimina físicamente: se conservan pedidos, movimientos e historial. Una fila con `Activo=no` también lo desactiva explícitamente. El workflow rechaza hojas vacías y no llama a `finish` si algún lote contiene errores.

## Flujo de Google Drive XLSX

Usa `Google Drive Trigger` para detectar actualización del archivo (y un Schedule Trigger de respaldo), `Google Drive → Download`, después `Extract From File → Extract From XLSX`. Normaliza los encabezados en un nodo `Edit Fields` y reutiliza la misma secuencia Start → Batch → Finish. El CRM no procesa XLSX directamente para evitar añadir una librería de lectura con vulnerabilidades conocidas; n8n sí lo convierte de forma aislada antes de enviar JSON validado.

## Límites y seguridad

- Máximo 500 productos por lote y 20,000 filas en una importación CSV manual.
- CSV manual: máximo 5 MB, con `SKU` y `Nombre` obligatorios.
- No envíes costo interno a los clientes: el contexto de IA solo incluye precio de venta y stock disponible.
- Las búsquedas semánticas se generan bajo demanda para descripciones/nombres; precio y existencias siempre salen de las tablas operativas.
