-- name: GetCIAuditLogs :many
SELECT
    a.id,
    a.entity_type,
    a.entity_id,
    a.affected_owner_group_ids,
    a.actor_id,
    a.action,
    a.diff,
    a.created_at,
    u.name AS actor_name,
    u.email AS actor_email
FROM audit_logs a
JOIN users u ON u.id = a.actor_id
WHERE a.entity_id = @entity_id::uuid
  AND (
      @has_cursor::boolean = false
      OR a.created_at < @last_created_at::timestamptz
      OR (a.created_at = @last_created_at::timestamptz AND a.id < @last_id::uuid)
  )
ORDER BY a.created_at DESC, a.id DESC
LIMIT CASE WHEN @limit_val::integer <= 0 THEN 20 ELSE @limit_val::integer END;

-- name: CountCIAuditLogs :one
SELECT count(*)::integer AS total_count
FROM audit_logs
WHERE entity_id = @entity_id::uuid;

-- name: ExportAuditLogs :many
SELECT
    a.id,
    a.entity_type,
    a.entity_id,
    a.affected_owner_group_ids,
    a.actor_id,
    a.action,
    a.diff,
    a.created_at,
    u.name AS actor_name,
    u.email AS actor_email
FROM audit_logs a
JOIN users u ON u.id = a.actor_id
WHERE (
    @owner_group_id::uuid IS NULL
    OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid
    OR @owner_group_id::uuid = ANY(a.affected_owner_group_ids)
)
AND (@from_time::timestamptz = '0001-01-01 00:00:00Z'::timestamptz OR a.created_at >= @from_time::timestamptz)
AND (@to_time::timestamptz = '0001-01-01 00:00:00Z'::timestamptz OR a.created_at <= @to_time::timestamptz)
ORDER BY a.created_at ASC, a.id ASC;
