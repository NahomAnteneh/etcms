-- +goose Up
ALTER TYPE lifecycle_state_enum ADD VALUE IF NOT EXISTS 'synced';
ALTER TYPE lifecycle_state_enum ADD VALUE IF NOT EXISTS 'out_of_sync';

-- +goose Down
-- In PostgreSQL, enum values cannot be removed without dropping the type.
