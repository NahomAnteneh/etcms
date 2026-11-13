-- name: GetEdgeWithDetails :one
SELECT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status,
    e.created_by,
    e.confirmed_by,
    e.confirmed_at,
    e.created_at,
    e.updated_at,
    -- Source CI details
    s.name AS source_ci_name,
    s.ci_class AS source_ci_class,
    s.environment AS source_ci_environment,
    s.owner_group_id AS source_owner_group_id,
    s.technical_contact AS source_technical_contact,
    sog.name AS source_owner_group_name,
    sog.department_name AS source_department_name,
    -- Target CI details
    t.name AS target_ci_name,
    t.ci_class AS target_ci_class,
    t.environment AS target_ci_environment,
    t.owner_group_id AS target_owner_group_id,
    t.technical_contact AS target_technical_contact,
    tog.name AS target_owner_group_name,
    tog.department_name AS target_department_name
FROM ci_edges e
JOIN cis s ON s.ci_id = e.source_ci_id
JOIN owner_groups sog ON sog.id = s.owner_group_id
JOIN cis t ON t.ci_id = e.target_ci_id
JOIN owner_groups tog ON tog.id = t.owner_group_id
WHERE e.id = $1;

-- name: ListPendingEdgesForGroups :many
SELECT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status,
    e.created_by,
    e.confirmed_by,
    e.confirmed_at,
    e.created_at,
    e.updated_at,
    -- Source CI details
    s.name AS source_ci_name,
    s.ci_class AS source_ci_class,
    s.environment AS source_ci_environment,
    s.owner_group_id AS source_owner_group_id,
    s.technical_contact AS source_technical_contact,
    sog.name AS source_owner_group_name,
    sog.department_name AS source_department_name,
    -- Target CI details
    t.name AS target_ci_name,
    t.ci_class AS target_ci_class,
    t.environment AS target_ci_environment,
    t.owner_group_id AS target_owner_group_id,
    t.technical_contact AS target_technical_contact,
    tog.name AS target_owner_group_name,
    tog.department_name AS target_department_name
FROM ci_edges e
JOIN cis s ON s.ci_id = e.source_ci_id
JOIN owner_groups sog ON sog.id = s.owner_group_id
JOIN cis t ON t.ci_id = e.target_ci_id
JOIN owner_groups tog ON tog.id = t.owner_group_id
WHERE e.handshake_status = 'pending_confirmation'
  AND t.owner_group_id = ANY(@owner_group_ids::uuid[])
ORDER BY e.created_at DESC;

-- name: ListPendingEdgesForGroup :many
SELECT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status,
    e.created_by,
    e.confirmed_by,
    e.confirmed_at,
    e.created_at,
    e.updated_at,
    -- Source CI details
    s.name AS source_ci_name,
    s.ci_class AS source_ci_class,
    s.environment AS source_ci_environment,
    s.owner_group_id AS source_owner_group_id,
    s.technical_contact AS source_technical_contact,
    sog.name AS source_owner_group_name,
    sog.department_name AS source_department_name,
    -- Target CI details
    t.name AS target_ci_name,
    t.ci_class AS target_ci_class,
    t.environment AS target_ci_environment,
    t.owner_group_id AS target_owner_group_id,
    t.technical_contact AS target_technical_contact,
    tog.name AS target_owner_group_name,
    tog.department_name AS target_department_name
FROM ci_edges e
JOIN cis s ON s.ci_id = e.source_ci_id
JOIN owner_groups sog ON sog.id = s.owner_group_id
JOIN cis t ON t.ci_id = e.target_ci_id
JOIN owner_groups tog ON tog.id = t.owner_group_id
WHERE e.handshake_status = 'pending_confirmation'
  AND t.owner_group_id = $1
ORDER BY e.created_at DESC;

-- name: ListAllPendingEdges :many
SELECT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status,
    e.created_by,
    e.confirmed_by,
    e.confirmed_at,
    e.created_at,
    e.updated_at,
    -- Source CI details
    s.name AS source_ci_name,
    s.ci_class AS source_ci_class,
    s.environment AS source_ci_environment,
    s.owner_group_id AS source_owner_group_id,
    s.technical_contact AS source_technical_contact,
    sog.name AS source_owner_group_name,
    sog.department_name AS source_department_name,
    -- Target CI details
    t.name AS target_ci_name,
    t.ci_class AS target_ci_class,
    t.environment AS target_ci_environment,
    t.owner_group_id AS target_owner_group_id,
    t.technical_contact AS target_technical_contact,
    tog.name AS target_owner_group_name,
    tog.department_name AS target_department_name
FROM ci_edges e
JOIN cis s ON s.ci_id = e.source_ci_id
JOIN owner_groups sog ON sog.id = s.owner_group_id
JOIN cis t ON t.ci_id = e.target_ci_id
JOIN owner_groups tog ON tog.id = t.owner_group_id
WHERE e.handshake_status = 'pending_confirmation'
ORDER BY e.created_at DESC;

-- name: UpdateEdgeHandshake :one
UPDATE ci_edges
SET handshake_status = $2,
    confirmed_by = $3,
    confirmed_at = $4,
    updated_at = now()
WHERE id = $1
RETURNING id, source_ci_id, target_ci_id, edge_type, handshake_status, created_by, confirmed_by, confirmed_at, created_at, updated_at;
