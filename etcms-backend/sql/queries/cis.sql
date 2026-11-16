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
        WHEN @query::text = '' THEN 1.0::real
        WHEN length(@query::text) >= 3 THEN
            GREATEST(similarity(c.name, @query::text), similarity(COALESCE(c.primary_endpoint, ''), @query::text))
        WHEN c.name ILIKE @query::text || '%' OR COALESCE(c.primary_endpoint, '') ILIKE @query::text || '%' THEN 1.0::real
        ELSE 0.0::real
    END AS score
FROM cis c
JOIN owner_groups og ON og.id = c.owner_group_id
WHERE (
      CASE
          WHEN @lifecycle_state::text IS NOT NULL AND @lifecycle_state::text != ''
              THEN c.lifecycle_state::text = @lifecycle_state::text
          ELSE c.lifecycle_state != 'retired'
      END
  )
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
      OR (length(@query::text) >= 3 AND (c.name % @query::text OR COALESCE(c.primary_endpoint, '') % @query::text OR similarity(c.name, @query::text) > 0.1 OR similarity(COALESCE(c.primary_endpoint, ''), @query::text) > 0.1))
  )
  AND (
      @has_cursor::boolean = false
      OR (
          (CASE
              WHEN @query::text = '' THEN 1.0::real
              WHEN length(@query::text) >= 3 THEN
                  GREATEST(similarity(c.name, @query::text), similarity(COALESCE(c.primary_endpoint, ''), @query::text))
              WHEN c.name ILIKE @query::text || '%' OR COALESCE(c.primary_endpoint, '') ILIKE @query::text || '%' THEN 1.0::real
              ELSE 0.0::real
          END) < @last_score::real
          OR (
              (CASE
                  WHEN @query::text = '' THEN 1.0::real
                  WHEN length(@query::text) >= 3 THEN
                      GREATEST(similarity(c.name, @query::text), similarity(COALESCE(c.primary_endpoint, ''), @query::text))
                  WHEN c.name ILIKE @query::text || '%' OR COALESCE(c.primary_endpoint, '') ILIKE @query::text || '%' THEN 1.0::real
                  ELSE 0.0::real
              END) = @last_score::real
              AND (c.name > @last_name::text OR (c.name = @last_name::text AND c.ci_id > @last_ci_id::uuid))
          )
      )
  )
ORDER BY score DESC, c.name ASC, c.ci_id ASC
LIMIT CASE WHEN @limit_val::integer <= 0 THEN 20 ELSE @limit_val::integer END;

-- name: CountSearchCIs :one
SELECT count(*)::integer AS total_count
FROM cis c
WHERE (
      CASE
          WHEN @lifecycle_state::text IS NOT NULL AND @lifecycle_state::text != ''
              THEN c.lifecycle_state::text = @lifecycle_state::text
          ELSE c.lifecycle_state != 'retired'
      END
  )
  AND (@ci_class::text IS NULL OR @ci_class::text = '' OR c.ci_class::text = @ci_class::text)
  AND (@environment::text IS NULL OR @environment::text = '' OR c.environment::text = @environment::text)
  AND (@owner_group_id::uuid IS NULL OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR c.owner_group_id = @owner_group_id)
  AND (
      @query::text = ''
      OR (length(@query::text) < 3 AND (c.name ILIKE @query::text || '%' OR COALESCE(c.primary_endpoint, '') ILIKE @query::text || '%'))
      OR (length(@query::text) >= 3 AND (c.name % @query::text OR COALESCE(c.primary_endpoint, '') % @query::text OR similarity(c.name, @query::text) > 0.1 OR similarity(COALESCE(c.primary_endpoint, ''), @query::text) > 0.1))
  );

-- name: GetCIDetailAggregates :one
WITH RECURSIVE
upstream AS (
    SELECT e.source_ci_id AS ci_id, 1 AS depth
    FROM ci_edges e
    WHERE e.target_ci_id = @ci_id::uuid
    UNION
    SELECT e.source_ci_id, u.depth + 1
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ci_id
    WHERE u.depth < 15
),
downstream AS (
    SELECT e.target_ci_id AS ci_id, 1 AS depth
    FROM ci_edges e
    WHERE e.source_ci_id = @ci_id::uuid
    UNION
    SELECT e.target_ci_id, d.depth + 1
    FROM ci_edges e
    JOIN downstream d ON e.source_ci_id = d.ci_id
    WHERE d.depth < 15
)
SELECT
    (SELECT count(*)::integer FROM ci_edges WHERE target_ci_id = @ci_id::uuid) AS direct_dependent_count,
    (SELECT count(DISTINCT ci_id)::integer FROM upstream) AS total_upstream_count,
    COALESCE((
        SELECT c.criticality_tier::text
        FROM upstream u
        JOIN cis c ON c.ci_id = u.ci_id
        ORDER BY
            CASE c.criticality_tier
                WHEN 'tier_0' THEN 0
                WHEN 'tier_1' THEN 1
                WHEN 'tier_2' THEN 2
                WHEN 'tier_3' THEN 3
                ELSE 4
            END ASC
        LIMIT 1
    ), '')::text AS highest_criticality_tier,
    (SELECT count(*)::integer FROM ci_edges WHERE source_ci_id = @ci_id::uuid) AS direct_dependency_count,
    (SELECT count(DISTINCT ci_id)::integer FROM downstream) AS total_downstream_count,
    (SELECT count(*)::integer FROM ci_edges WHERE (source_ci_id = @ci_id::uuid OR target_ci_id = @ci_id::uuid) AND handshake_status = 'pending_confirmation') AS pending_edge_count,
    (SELECT count(*)::integer FROM ci_flags WHERE ci_id = @ci_id::uuid AND status = 'open') AS open_flag_count;

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

-- name: CreateCI :one
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
RETURNING ci_id, name, ci_class, environment, lifecycle_state, criticality_tier, owner_group_id, technical_contact, primary_endpoint, last_verified_at, itam_external_ref, class_metadata, created_at, updated_at;

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

-- name: UpdateCI :one
WITH updated AS (
    UPDATE cis
    SET
        name = @name,
        ci_class = @ci_class,
        environment = @environment,
        lifecycle_state = @lifecycle_state,
        criticality_tier = @criticality_tier,
        owner_group_id = @owner_group_id,
        technical_contact = @technical_contact,
        primary_endpoint = @primary_endpoint,
        last_verified_at = @last_verified_at,
        itam_external_ref = @itam_external_ref,
        class_metadata = @class_metadata,
        updated_at = @updated_at
    WHERE ci_id = @ci_id
    RETURNING *
)
SELECT
    u.ci_id,
    u.name,
    u.ci_class,
    u.environment,
    u.lifecycle_state,
    u.criticality_tier,
    u.owner_group_id,
    u.technical_contact,
    u.primary_endpoint,
    u.last_verified_at,
    u.itam_external_ref,
    u.class_metadata,
    u.created_at,
    u.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email
FROM updated u
JOIN owner_groups og ON og.id = u.owner_group_id;

-- name: CreateCIFlag :one
INSERT INTO ci_flags (
    id,
    ci_id,
    flagged_by,
    reason,
    status,
    created_at
) VALUES (
    @id,
    @ci_id,
    @flagged_by,
    @reason,
    'open',
    @created_at
)
RETURNING id, ci_id, flagged_by, reason, status, created_at, resolved_at, resolved_by;

-- name: GetCIFlagByID :one
SELECT id, ci_id, flagged_by, reason, status, created_at, resolved_at, resolved_by
FROM ci_flags
WHERE id = $1;

-- name: VerifyCI :one
WITH updated AS (
    UPDATE cis
    SET
        last_verified_at = @verified_at,
        updated_at = @verified_at
    WHERE ci_id = @ci_id
    RETURNING *
)
SELECT
    u.ci_id,
    u.name,
    u.ci_class,
    u.environment,
    u.lifecycle_state,
    u.criticality_tier,
    u.owner_group_id,
    u.technical_contact,
    u.primary_endpoint,
    u.last_verified_at,
    u.itam_external_ref,
    u.class_metadata,
    u.created_at,
    u.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email
FROM updated u
JOIN owner_groups og ON og.id = u.owner_group_id;

-- name: ResolveCIFlagsForCI :exec
UPDATE ci_flags
SET
    status = 'resolved',
    resolved_at = @resolved_at,
    resolved_by = @resolved_by
WHERE ci_id = @ci_id
  AND status = 'open';

-- name: GetActiveUpstreamDependents :many
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
    og.name AS owner_group_name
FROM ci_edges e
JOIN cis c ON c.ci_id = e.source_ci_id
JOIN owner_groups og ON og.id = c.owner_group_id
WHERE e.target_ci_id = @target_ci_id
  AND c.lifecycle_state = 'in_service'
ORDER BY c.name ASC;

-- name: RetireCI :one
WITH updated AS (
    UPDATE cis
    SET
        lifecycle_state = 'retired',
        updated_at = @retired_at
    WHERE ci_id = @ci_id
    RETURNING *
)
SELECT
    u.ci_id,
    u.name,
    u.ci_class,
    u.environment,
    u.lifecycle_state,
    u.criticality_tier,
    u.owner_group_id,
    u.technical_contact,
    u.primary_endpoint,
    u.last_verified_at,
    u.itam_external_ref,
    u.class_metadata,
    u.created_at,
    u.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email
FROM updated u
JOIN owner_groups og ON og.id = u.owner_group_id;


