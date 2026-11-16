-- name: CreateOwnerGroup :one
INSERT INTO owner_groups (
    id, name, slug, department_name, team_lead_name, team_lead_email, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, now()
)
RETURNING id, name, slug, department_name, team_lead_name, team_lead_email, created_at;

-- name: UpdateOwnerGroup :one
UPDATE owner_groups
SET name = $2,
    slug = $3,
    department_name = $4,
    team_lead_name = $5,
    team_lead_email = $6
WHERE id = $1
RETURNING id, name, slug, department_name, team_lead_name, team_lead_email, created_at;

-- name: DeleteOwnerGroup :exec
DELETE FROM owner_groups
WHERE id = $1;

-- name: ListCIClasses :many
SELECT id, label, category, description, icon, is_system, attributes, form_fields, created_at, updated_at
FROM ci_classes
ORDER BY is_system DESC, label ASC;

-- name: CreateCIClass :one
INSERT INTO ci_classes (
    id, label, category, description, icon, is_system, attributes, form_fields, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, now(), now()
)
RETURNING id, label, category, description, icon, is_system, attributes, form_fields, created_at, updated_at;

-- name: UpdateCIClass :one
UPDATE ci_classes
SET label = $2,
    category = $3,
    description = $4,
    icon = $5,
    attributes = $6,
    form_fields = $7,
    updated_at = now()
WHERE id = $1
RETURNING id, label, category, description, icon, is_system, attributes, form_fields, created_at, updated_at;

-- name: DeleteCIClass :exec
DELETE FROM ci_classes
WHERE id = $1;

-- name: CountCIsByClass :one
SELECT COUNT(*) FROM cis
WHERE ci_class = $1;

-- name: ListCategories :many
SELECT 
    c.id, 
    c.name, 
    c.description, 
    c.icon, 
    c.color, 
    c.created_at, 
    c.updated_at,
    COUNT(DISTINCT cl.id) AS class_count,
    COUNT(DISTINCT ci.ci_id) FILTER (WHERE ci.lifecycle_state = 'in_service') AS ci_count
FROM ci_categories c
LEFT JOIN ci_classes cl ON (cl.category = c.name OR cl.category = c.id)
LEFT JOIN cis ci ON ci.ci_class = cl.id
GROUP BY c.id, c.name, c.description, c.icon, c.color, c.created_at, c.updated_at
ORDER BY c.name ASC;

-- name: GetCategoryByID :one
SELECT id, name, description, icon, color, created_at, updated_at
FROM ci_categories
WHERE id = $1;

-- name: CreateCategory :one
INSERT INTO ci_categories (
    id, name, description, icon, color, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, now(), now()
)
RETURNING id, name, description, icon, color, created_at, updated_at;

-- name: UpdateCategory :one
UPDATE ci_categories
SET name = $2,
    description = $3,
    icon = $4,
    color = $5,
    updated_at = now()
WHERE id = $1
RETURNING id, name, description, icon, color, created_at, updated_at;

-- name: DeleteCategory :exec
DELETE FROM ci_categories
WHERE id = $1;

-- name: CountClassesAndCIsByCategory :one
SELECT 
    COUNT(DISTINCT cl.id) AS class_count, 
    COUNT(DISTINCT ci.ci_id) AS ci_count
FROM ci_categories c
LEFT JOIN ci_classes cl ON (cl.category = c.name OR cl.category = c.id)
LEFT JOIN cis ci ON ci.ci_class = cl.id
WHERE c.id = $1;

-- name: ListRelationshipTypes :many
SELECT 
    r.id, 
    r.label, 
    r.reverse_label, 
    r.description, 
    r.color, 
    r.created_at, 
    r.updated_at,
    COUNT(e.id) AS edge_count
FROM relationship_types r
LEFT JOIN ci_edges e ON e.edge_type = r.id
GROUP BY r.id, r.label, r.reverse_label, r.description, r.color, r.created_at, r.updated_at
ORDER BY r.label ASC;

-- name: GetRelationshipTypeByID :one
SELECT id, label, reverse_label, description, color, created_at, updated_at
FROM relationship_types
WHERE id = $1;

-- name: CreateRelationshipType :one
INSERT INTO relationship_types (
    id, label, reverse_label, description, color, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, now(), now()
)
RETURNING id, label, reverse_label, description, color, created_at, updated_at;

-- name: UpdateRelationshipType :one
UPDATE relationship_types
SET label = $2,
    reverse_label = $3,
    description = $4,
    color = $5,
    updated_at = now()
WHERE id = $1
RETURNING id, label, reverse_label, description, color, created_at, updated_at;

-- name: DeleteRelationshipType :exec
DELETE FROM relationship_types
WHERE id = $1;

-- name: CountEdgesByRelationshipType :one
SELECT COUNT(*) FROM ci_edges
WHERE edge_type = $1;
