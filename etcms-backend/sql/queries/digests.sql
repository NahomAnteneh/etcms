-- name: CreateDigestCycle :one
INSERT INTO digest_cycles (
    id,
    owner_group_id,
    window_start,
    window_end,
    status,
    created_at
) VALUES (
    @id,
    @owner_group_id,
    @window_start,
    @window_end,
    'open',
    @created_at
)
ON CONFLICT (owner_group_id, window_start) DO NOTHING
RETURNING id, owner_group_id, window_start, window_end, status, created_at, closed_at;

-- name: GetDigestCycleByGroupAndWindow :one
SELECT id, owner_group_id, window_start, window_end, status, created_at, closed_at
FROM digest_cycles
WHERE owner_group_id = @owner_group_id AND window_start = @window_start;

-- name: GetActiveDigestCycleByOwnerGroup :one
SELECT id, owner_group_id, window_start, window_end, status, created_at, closed_at
FROM digest_cycles
WHERE owner_group_id = $1 AND status = 'open'
ORDER BY window_start DESC
LIMIT 1;

-- name: ClosePreviousOpenCycles :many
UPDATE digest_cycles
SET status = 'closed', closed_at = @closed_at
WHERE owner_group_id = @owner_group_id
  AND window_start < @current_window_start
  AND status = 'open'
RETURNING id;

-- name: ExpireUnActionedItemsForCycles :exec
UPDATE digest_items
SET status = 'expired'
WHERE cycle_id = ANY(@cycle_ids::uuid[])
  AND status = 'open';

-- name: GetCandidateCIsForDigest :many
SELECT
    c.ci_id,
    c.name,
    c.ci_class,
    c.environment,
    c.lifecycle_state,
    c.criticality_tier,
    c.owner_group_id,
    c.technical_contact,
    c.primary_endpoint,
    c.last_verified_at,
    c.updated_at,
    (SELECT count(*)::integer FROM ci_flags f WHERE f.ci_id = c.ci_id AND f.status = 'open') AS open_flag_count,
    (SELECT count(*)::integer FROM ci_edges e WHERE e.target_ci_id = c.ci_id AND e.handshake_status = 'pending_confirmation') AS pending_edge_count
FROM cis c
WHERE c.owner_group_id = @owner_group_id::uuid
  AND c.lifecycle_state != 'retired'
  AND (
      (c.lifecycle_state = 'in_service' AND c.last_verified_at < @stale_threshold::timestamptz)
      OR
      (c.created_at >= @since_time::timestamptz OR c.updated_at >= @since_time::timestamptz)
      OR
      EXISTS (SELECT 1 FROM ci_edges e WHERE e.target_ci_id = c.ci_id AND e.handshake_status = 'pending_confirmation')
      OR
      EXISTS (SELECT 1 FROM ci_flags f WHERE f.ci_id = c.ci_id AND f.status = 'open')
  )
ORDER BY c.name ASC;

-- name: InsertDigestItem :one
INSERT INTO digest_items (
    id,
    cycle_id,
    ci_id,
    trigger_reason,
    status,
    created_at
) VALUES (
    @id,
    @cycle_id,
    @ci_id,
    @trigger_reason,
    'open',
    @created_at
)
ON CONFLICT (cycle_id, ci_id) DO NOTHING
RETURNING id, cycle_id, ci_id, trigger_reason, status, actioned_at, action_type, created_at;

-- name: GetDigestItemsByCycle :many
SELECT
    di.id,
    di.cycle_id,
    di.ci_id,
    di.trigger_reason,
    di.status,
    di.actioned_at,
    di.action_type,
    di.created_at,
    c.name AS ci_name,
    c.ci_class,
    c.environment,
    c.lifecycle_state,
    c.criticality_tier,
    c.technical_contact,
    c.primary_endpoint,
    c.last_verified_at
FROM digest_items di
JOIN cis c ON c.ci_id = di.ci_id
WHERE di.cycle_id = $1
ORDER BY di.created_at ASC, c.name ASC;

-- name: ListAllOwnerGroups :many
SELECT id, name, slug, department_name, team_lead_name, team_lead_email, created_at
FROM owner_groups
ORDER BY name ASC;

-- name: ActionDigestItemsForCI :exec
UPDATE digest_items di
SET
    status = 'actioned',
    actioned_at = @actioned_at,
    action_type = @action_type
FROM digest_cycles dc
WHERE di.cycle_id = dc.id
  AND di.ci_id = @ci_id
  AND dc.status = 'open'
  AND di.status = 'open';


