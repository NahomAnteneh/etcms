-- name: GetHealthFreshness :one
SELECT
    count(*)::integer AS total_in_service,
    count(*) FILTER (WHERE c.last_verified_at >= now() - interval '60 days')::integer AS fresh_count,
    count(*) FILTER (WHERE c.last_verified_at < now() - interval '60 days')::integer AS stale_count
FROM cis c
WHERE c.lifecycle_state = 'in_service'
  AND (
      @owner_group_id::uuid IS NULL
      OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      OR c.owner_group_id = @owner_group_id
  );

-- name: GetHealthOrphans :one
WITH RECURSIVE upstream AS (
    SELECT
        e.target_ci_id AS technical_ci_id,
        e.source_ci_id AS ancestor_id,
        c.ci_class AS ancestor_class,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE c.lifecycle_state = 'in_service'
      AND e.handshake_status = 'confirmed'
    UNION
    SELECT
        u.technical_ci_id,
        e.source_ci_id AS ancestor_id,
        c.ci_class AS ancestor_class,
        u.depth + 1 AS depth
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ancestor_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE u.depth < 15
      AND c.lifecycle_state = 'in_service'
      AND e.handshake_status = 'confirmed'
)
SELECT count(*)::integer AS orphan_count
FROM cis c
WHERE c.lifecycle_state = 'in_service'
  AND c.ci_class IN ('database', 'vm_cluster', 'physical_host', 'network_firewall')
  AND (
      @owner_group_id::uuid IS NULL
      OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      OR c.owner_group_id = @owner_group_id
  )
  AND NOT EXISTS (
      SELECT 1 FROM upstream u
      WHERE u.technical_ci_id = c.ci_id
        AND u.ancestor_class IN ('business_service', 'application')
  );

-- name: GetHealthPendingEdges :one
SELECT
    count(*)::integer AS pending_edges_count,
    COALESCE(EXTRACT(EPOCH FROM (now() - min(e.created_at))) / 86400.0, 0.0)::float8 AS oldest_pending_age_days
FROM ci_edges e
JOIN cis c ON c.ci_id = e.target_ci_id
WHERE e.handshake_status = 'pending_confirmation'
  AND (
      @owner_group_id::uuid IS NULL
      OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      OR c.owner_group_id = @owner_group_id
  );

-- name: GetHealthDigestCompletion :one
SELECT
    count(*)::integer AS total_closed_items,
    count(*) FILTER (WHERE di.status = 'actioned')::integer AS actioned_closed_items
FROM digest_items di
JOIN digest_cycles dc ON dc.id = di.cycle_id
WHERE dc.status = 'closed'
  AND (
      @owner_group_id::uuid IS NULL
      OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      OR dc.owner_group_id = @owner_group_id
  );
