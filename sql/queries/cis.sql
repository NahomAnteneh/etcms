-- name: GetActiveCIsByOwnerGroup :many
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
    c.itam_external_ref,
    c.class_metadata,
    c.created_at,
    c.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email
FROM cis c
JOIN owner_groups og ON og.id = c.owner_group_id
WHERE c.owner_group_id = $1 AND c.lifecycle_state != 'retired'
ORDER BY c.name ASC;

-- name: SearchCIs :many
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
    c.itam_external_ref,
    c.class_metadata,
    c.created_at,
    c.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email,
    CASE
        WHEN length(@query::text) >= 3 THEN
            GREATEST(similarity(c.name, @query::text), similarity(COALESCE(c.primary_endpoint, ''), @query::text))
        WHEN c.name ILIKE @query::text || '%' OR COALESCE(c.primary_endpoint, '') ILIKE @query::text || '%' THEN 1.0::real
        ELSE 0.0::real
    END AS score
FROM cis c
JOIN owner_groups og ON og.id = c.owner_group_id
WHERE c.lifecycle_state != 'retired'
  AND (
      @ci_class::text IS NULL OR @ci_class::text = '' OR c.ci_class::text = @ci_class::text
  )
  AND (
      @environment::text IS NULL OR @environment::text = '' OR c.environment::text = @environment::text
  )
  AND (
      @owner_group_id::uuid IS NULL OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR c.owner_group_id = @owner_group_id
  )
  AND (
      @query::text = ''
      OR (length(@query::text) < 3 AND (c.name ILIKE @query::text || '%' OR COALESCE(c.primary_endpoint, '') ILIKE @query::text || '%'))
      OR (length(@query::text) >= 3 AND (c.name % @query::text OR COALESCE(c.primary_endpoint, '') % @query::text OR similarity(c.name, @query::text) > 0.1))
  )
ORDER BY score DESC, c.name ASC, c.ci_id ASC
LIMIT CASE WHEN @limit_val::integer <= 0 THEN 20 ELSE @limit_val::integer END;

-- name: GetCIByID :one
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
    c.itam_external_ref,
    c.class_metadata,
    c.created_at,
    c.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email
FROM cis c
JOIN owner_groups og ON og.id = c.owner_group_id
WHERE c.ci_id = $1;

-- name: UpsertCI :one
INSERT INTO cis (
    ci_id,
    name,
    ci_class,
    environment,
    lifecycle_state,
    criticality_tier,
    owner_group_id,
    technical_contact,
    primary_endpoint,
    last_verified_at,
    itam_external_ref,
    class_metadata,
    created_at,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
ON CONFLICT (lower(name), ci_class, environment) WHERE lifecycle_state != 'retired'
DO UPDATE SET
    criticality_tier = EXCLUDED.criticality_tier,
    owner_group_id = EXCLUDED.owner_group_id,
    technical_contact = EXCLUDED.technical_contact,
    primary_endpoint = EXCLUDED.primary_endpoint,
    class_metadata = EXCLUDED.class_metadata,
    last_verified_at = EXCLUDED.last_verified_at,
    updated_at = EXCLUDED.updated_at
RETURNING ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at;

-- name: UpsertEdge :one
INSERT INTO ci_edges (
    id,
    source_ci_id,
    target_ci_id,
    edge_type,
    handshake_status,
    created_by,
    confirmed_by,
    confirmed_at,
    created_at,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
)
ON CONFLICT (source_ci_id, target_ci_id, edge_type)
DO UPDATE SET
    handshake_status = EXCLUDED.handshake_status,
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_at = EXCLUDED.confirmed_at,
    updated_at = EXCLUDED.updated_at
RETURNING id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at;
