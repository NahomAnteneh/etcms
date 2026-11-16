-- name: GetUpwardImpactNodes :many
WITH RECURSIVE upstream AS (
    SELECT
        e.source_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE e.target_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
    UNION
    SELECT
        e.source_ci_id AS ci_id,
        u.depth + 1 AS depth
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ci_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE u.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
),
deduped_upstream AS (
    SELECT
        ci_id,
        min(depth)::integer AS depth
    FROM upstream
    GROUP BY ci_id
)
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
    du.depth
FROM deduped_upstream du
JOIN cis c ON c.ci_id = du.ci_id
JOIN owner_groups og ON og.id = c.owner_group_id
ORDER BY du.depth ASC, c.name ASC;

-- name: GetUpwardImpactEdges :many
WITH RECURSIVE upstream AS (
    SELECT
        e.source_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE e.target_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
    UNION
    SELECT
        e.source_ci_id AS ci_id,
        u.depth + 1 AS depth
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ci_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE u.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
),
all_nodes AS (
    SELECT @start_ci_id::uuid AS ci_id
    UNION
    SELECT ci_id FROM upstream
)
SELECT DISTINCT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status
FROM ci_edges e
JOIN all_nodes s ON e.source_ci_id = s.ci_id
JOIN all_nodes t ON e.target_ci_id = t.ci_id
ORDER BY e.edge_type, e.source_ci_id;

-- name: GetSiblingDependencies :many
WITH RECURSIVE upstream AS (
    SELECT
        e.source_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE e.target_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
    UNION
    SELECT
        e.source_ci_id AS ci_id,
        u.depth + 1 AS depth
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ci_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE u.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
),
app_nodes AS (
    SELECT u.ci_id
    FROM upstream u
    JOIN cis c ON c.ci_id = u.ci_id
    WHERE c.ci_class = 'application'
)
SELECT DISTINCT
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
FROM ci_edges e
JOIN app_nodes an ON e.source_ci_id = an.ci_id
JOIN cis c ON c.ci_id = e.target_ci_id
JOIN owner_groups og ON og.id = c.owner_group_id
WHERE e.target_ci_id != @start_ci_id::uuid
  AND (
      @include_retired::boolean = true
      OR c.lifecycle_state != 'retired'
  )
ORDER BY c.name ASC;

-- name: GetDownwardDependencyNodes :many
WITH RECURSIVE downstream AS (
    SELECT
        e.target_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE e.source_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
    UNION
    SELECT
        e.target_ci_id AS ci_id,
        d.depth + 1 AS depth
    FROM ci_edges e
    JOIN downstream d ON e.source_ci_id = d.ci_id
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE d.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
),
deduped_downstream AS (
    SELECT
        ci_id,
        min(depth)::integer AS depth
    FROM downstream
    GROUP BY ci_id
)
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
    dd.depth
FROM deduped_downstream dd
JOIN cis c ON c.ci_id = dd.ci_id
JOIN owner_groups og ON og.id = c.owner_group_id
ORDER BY dd.depth ASC, c.name ASC;

-- name: GetDownwardDependencyEdges :many
WITH RECURSIVE downstream AS (
    SELECT
        e.target_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE e.source_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
    UNION
    SELECT
        e.target_ci_id AS ci_id,
        d.depth + 1 AS depth
    FROM ci_edges e
    JOIN downstream d ON e.source_ci_id = d.ci_id
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE d.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state != 'retired'
      )
),
all_nodes AS (
    SELECT @start_ci_id::uuid AS ci_id
    UNION
    SELECT ci_id FROM downstream
)
SELECT DISTINCT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status
FROM ci_edges e
JOIN all_nodes s ON e.source_ci_id = s.ci_id
JOIN all_nodes t ON e.target_ci_id = t.ci_id
ORDER BY e.edge_type, e.source_ci_id;

