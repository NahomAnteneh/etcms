-- name: CreateIntakeCampaign :one
INSERT INTO intake_campaigns (
    id, title, status, deadline, created_by, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING id, title, status, deadline, created_by, created_at;

-- name: CreateIntakeInvitation :one
INSERT INTO intake_invitations (
    id, campaign_id, owner_group_id, token_hash, team_lead_email, status, expires_at, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING id, campaign_id, owner_group_id, token_hash, team_lead_email, status, expires_at, last_accessed_at, created_at;

-- name: CreateIntakeSubmission :one
INSERT INTO intake_submissions (
    id, invitation_id, owner_group_id, status, payload, lock_version, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING id, invitation_id, owner_group_id, status, payload, lock_version, submitted_at, created_at, updated_at;

-- name: GetCampaignByID :one
SELECT id, title, status, deadline, created_by, created_at
FROM intake_campaigns
WHERE id = $1;

-- name: GetCampaignInvitationsWithGroup :many
SELECT
    i.id AS invitation_id,
    i.campaign_id,
    i.owner_group_id,
    i.token_hash,
    i.team_lead_email,
    i.status,
    i.expires_at,
    i.last_accessed_at,
    i.created_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name
FROM intake_invitations i
JOIN owner_groups og ON og.id = i.owner_group_id
WHERE i.campaign_id = $1
ORDER BY og.department_name ASC, og.name ASC;

-- name: GetCampaignDepartmentProgress :many
SELECT
    og.department_name,
    count(i.id)::bigint AS total_invitations,
    count(CASE WHEN i.status = 'sent' AND i.expires_at >= now() THEN 1 END)::bigint AS sent_count,
    count(CASE WHEN i.status = 'opened' AND i.expires_at >= now() THEN 1 END)::bigint AS opened_count,
    count(CASE WHEN i.status = 'submitted' THEN 1 END)::bigint AS submitted_count,
    count(CASE WHEN (i.status = 'expired' OR (i.status != 'submitted' AND i.expires_at < now())) THEN 1 END)::bigint AS overdue_count
FROM intake_invitations i
JOIN owner_groups og ON og.id = i.owner_group_id
WHERE i.campaign_id = $1
GROUP BY og.department_name
ORDER BY og.department_name ASC;

-- name: GetInvitationByTokenHash :one
SELECT
    i.id AS invitation_id,
    i.campaign_id,
    i.owner_group_id,
    i.token_hash,
    i.team_lead_email,
    i.status AS invitation_status,
    i.expires_at,
    i.last_accessed_at,
    c.title AS campaign_title,
    c.deadline AS campaign_deadline,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    s.id AS submission_id,
    s.status AS submission_status,
    s.payload AS submission_payload,
    s.lock_version AS submission_lock_version
FROM intake_invitations i
JOIN intake_campaigns c ON c.id = i.campaign_id
JOIN owner_groups og ON og.id = i.owner_group_id
LEFT JOIN intake_submissions s ON s.invitation_id = i.id
WHERE i.token_hash = $1;

-- name: UpdateInvitationAccess :exec
UPDATE intake_invitations
SET last_accessed_at = $2,
    status = CASE WHEN status = 'sent' THEN 'opened'::invitation_status_enum ELSE status END
WHERE id = $1;

-- name: UpdateIntakeDraft :one
UPDATE intake_submissions
SET payload = $2,
    lock_version = lock_version + 1,
    updated_at = now()
WHERE invitation_id = $1
  AND lock_version = $3
  AND status = 'draft'
RETURNING id, invitation_id, owner_group_id, status, payload, lock_version, submitted_at, created_at, updated_at;

-- name: GetSubmissionByInvitationID :one
SELECT id, invitation_id, owner_group_id, status, payload, lock_version, submitted_at, created_at, updated_at
FROM intake_submissions
WHERE invitation_id = $1;
