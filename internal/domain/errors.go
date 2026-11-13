package domain

import "errors"

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

// ValidationError represents semantic or business rule validation errors with node-level details.
type ValidationError struct {
	Message    string
	NodeErrors map[string][]string
}

func (e *ValidationError) Error() string {
	return e.Message
}
