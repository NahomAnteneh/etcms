-- name: ListCustomRoles :many
SELECT id, name, description, permissions, is_system, created_at, updated_at
FROM custom_roles
ORDER BY is_system DESC, name ASC;

-- name: GetCustomRoleByID :one
SELECT id, name, description, permissions, is_system, created_at, updated_at
FROM custom_roles
WHERE id = $1;

-- name: CreateCustomRole :one
INSERT INTO custom_roles (id, name, description, permissions, is_system, created_at, updated_at)
VALUES ($1, $2, $3, $4, false, now(), now())
RETURNING id, name, description, permissions, is_system, created_at, updated_at;

-- name: DeleteCustomRole :exec
DELETE FROM custom_roles
WHERE id = $1 AND is_system = false;
