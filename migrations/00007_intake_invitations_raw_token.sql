-- +goose Up
ALTER TABLE intake_invitations ADD COLUMN IF NOT EXISTS raw_token VARCHAR(255) NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE intake_invitations DROP COLUMN IF EXISTS raw_token;
