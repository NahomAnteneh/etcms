package domain

import (
	"errors"

	"github.com/google/uuid"
)

var (
	ErrForbidden           = errors.New("forbidden: insufficient permissions")
	ErrUnauthorized        = errors.New("unauthorized: authentication required")
	ErrNotFound            = errors.New("not found: resource does not exist")
	ErrConflict            = errors.New("conflict: state machine or dependency conflict")
	ErrLockVersionMismatch = errors.New("lock version mismatch")
	ErrSubmissionNotDraft  = errors.New("intake submission is not in draft status")
	ErrInvalidIfMatch      = errors.New("invalid If-Match header")
	ErrInvalidEdge         = errors.New("invalid edge: self-dependency is forbidden")
	ErrBadParam            = errors.New("bad request: invalid parameter")
)

// DependentCI represents an upstream dependency blocking CI retirement.
type DependentCI struct {
	CIID        uuid.UUID
	Name        string
	CIClass     string
	Environment string
}

// ConflictError represents a state-machine or dependency conflict error.
type ConflictError struct {
	Message      string
	DependentCIs []DependentCI
}

func (e *ConflictError) Error() string {
	return e.Message
}

func (e *ConflictError) Unwrap() error {
	return ErrConflict
}

// ValidationError represents semantic or business rule validation errors with node-level details.
type ValidationError struct {
	Message    string
	NodeErrors map[string][]string
}

func (e *ValidationError) Error() string {
	return e.Message
}
