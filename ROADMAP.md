# Roadmap de CineOps en Azure

## En curso

- Mover las operaciones administrativas de Blob (carga, finalización y eliminación) a Azure Functions.
- Mantener la alerta de servidor local desconectado visible únicamente al administrador dentro de Mantenimiento.
- Conservar Jellyfin/local para reproducción, subtítulos y transcodificación.

## Completado

- Usuarios, solicitudes, roles y sesiones disponibles en Azure Tables con respaldo local.
- Mantenimiento separado en “Usuarios y accesos” y “Películas y almacenamiento”.
- Consulta local-first con catálogo Azure como respaldo y eliminación de duplicados por identificador.
- Listado, carátulas y enlaces temporales de lectura de Blob servidos mediante Azure Functions.
- Jellyfin permanece como motor local de reproducción y transcodificación.

## Costos y beneficio gratuito

- Confirmar en Azure Cost Management la fecha exacta de inicio y vencimiento del beneficio de 12 meses de la suscripción.
- Crear presupuestos y alertas de costo antes de activar recursos que no escalen a cero.
- Azure Functions puede atender autenticación, permisos, catálogo, metadatos y operaciones administrativas con consumo muy bajo y normalmente dentro de la asignación gratuita.
- Azure Functions no se usará para transcodificar video: esa tarea requiere ejecución prolongada, CPU y memoria, y permanecerá en Jellyfin/local o en un servidor dedicado futuro.
- Blob Storage Hot comenzará con un límite operativo de 100 GB; revisar almacenamiento, transacciones y salida de datos mensualmente.
- No asumir que una VM seguirá siendo gratuita al terminar el beneficio de 12 meses; antes de migrar Jellyfin se calculará su costo permanente.

## Próximas etapas

1. Confirmar desde dos cuentas que la administración de accesos funciona sin depender del PC.
2. Migrar carga, finalización, cancelación y eliminación de Blob a Functions.
3. Mostrar el origen de cada película únicamente al administrador.
4. Añadir métricas de disponibilidad, almacenamiento y transferencia en Mantenimiento.
5. Evaluar VM Azure, OCI o arquitectura multinube únicamente para transcodificación, comparando el costo posterior a promociones.
