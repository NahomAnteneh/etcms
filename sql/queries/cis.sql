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
