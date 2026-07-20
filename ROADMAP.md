# Roadmap de CineOps en Azure

## En curso

- Mover usuarios, solicitudes, roles y sesiones a Azure Static Web Apps, Functions y Table Storage.
- Mantener la consulta local como primera opción para ahorrar transferencia y usar Azure Blob como respaldo cuando la película no esté disponible localmente.
- Mantener la alerta de servidor local desconectado visible únicamente al administrador dentro de Mantenimiento.
- Separar Mantenimiento en “Usuarios y accesos” y “Películas y almacenamiento”.
- Conservar Jellyfin/local para reproducción, subtítulos y transcodificación.

## Costos y beneficio gratuito

- Confirmar en Azure Cost Management la fecha exacta de inicio y vencimiento del beneficio de 12 meses de la suscripción.
- Crear presupuestos y alertas de costo antes de activar recursos que no escalen a cero.
- Azure Functions puede atender autenticación, permisos, catálogo, metadatos y operaciones administrativas con consumo muy bajo y normalmente dentro de la asignación gratuita.
- Azure Functions no se usará para transcodificar video: esa tarea requiere ejecución prolongada, CPU y memoria, y permanecerá en Jellyfin/local o en un servidor dedicado futuro.
- Blob Storage Hot comenzará con un límite operativo de 100 GB; revisar almacenamiento, transacciones y salida de datos mensualmente.
- No asumir que una VM seguirá siendo gratuita al terminar el beneficio de 12 meses; antes de migrar Jellyfin se calculará su costo permanente.

## Próximas etapas

1. Desplegar y probar la administración de accesos independiente del PC local.
2. Migrar catálogo y URLs seguras de Blob a Functions para que Azure siga navegable si el PC se apaga.
3. Implementar selección local-first/Azure-fallback por película y mostrar el origen solo al administrador.
4. Añadir métricas de disponibilidad, almacenamiento y transferencia en Mantenimiento.
5. Evaluar VM Azure, OCI o arquitectura multinube únicamente para transcodificación, comparando el costo posterior a promociones.
