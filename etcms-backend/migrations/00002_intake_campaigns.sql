-- +goose Up
-- Intake Campaign Enum Types
CREATE TYPE campaign_status_enum AS ENUM (
    'active',
    'closed',
    'archived'
);

CREATE TYPE invitation_status_enum AS ENUM (
    'sent',
    'opened',
    'submitted',
    'expired'
);

CREATE TYPE submission_status_enum AS ENUM (
    'draft',
    'submitted',
    'approved',
    'rejected'
);

-- Intake Campaigns Table
CREATE TABLE intake_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    status campaign_status_enum NOT NULL DEFAULT 'active',
    deadline TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intake_campaigns_status ON intake_campaigns(status);

-- Intake Invitations Table (with SHA-256 token hash)
CREATE TABLE intake_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES intake_campaigns(id) ON DELETE CASCADE,
    owner_group_id UUID NOT NULL REFERENCES owner_groups(id) ON DELETE RESTRICT,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    team_lead_email VARCHAR(255) NOT NULL,
    status invitation_status_enum NOT NULL DEFAULT 'sent',
    expires_at TIMESTAMPTZ NOT NULL,
    last_accessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_campaign_owner_group UNIQUE (campaign_id, owner_group_id)
);

CREATE INDEX idx_intake_invitations_campaign ON intake_invitations(campaign_id);
CREATE INDEX idx_intake_invitations_token_hash ON intake_invitations(token_hash);
CREATE INDEX idx_intake_invitations_status ON intake_invitations(status);

-- Intake Submissions Table
CREATE TABLE intake_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_id UUID NOT NULL REFERENCES intake_invitations(id) ON DELETE CASCADE,
    owner_group_id UUID NOT NULL REFERENCES owner_groups(id) ON DELETE RESTRICT,
    status submission_status_enum NOT NULL DEFAULT 'draft',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    lock_version INT NOT NULL DEFAULT 1,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_invitation_submission UNIQUE (invitation_id)
);

CREATE INDEX idx_intake_submissions_invitation ON intake_submissions(invitation_id);
CREATE INDEX idx_intake_submissions_owner_group ON intake_submissions(owner_group_id);

-- +goose Down
DROP TABLE IF EXISTS intake_submissions;
DROP TABLE IF EXISTS intake_invitations;
DROP TABLE IF EXISTS intake_campaigns;

DROP TYPE IF EXISTS submission_status_enum;
DROP TYPE IF EXISTS invitation_status_enum;
DROP TYPE IF EXISTS campaign_status_enum;
