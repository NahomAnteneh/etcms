package domain

import "errors"

var (
	ErrForbidden    = errors.New("forbidden: insufficient permissions")
	ErrUnauthorized = errors.New("unauthorized: authentication required")
	ErrNotFound     = errors.New("not found: resource does not exist")
	ErrConflict     = errors.New("conflict: state machine or dependency conflict")
)
