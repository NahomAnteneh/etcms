package domain

import (
	"errors"
	"fmt"
	"strings"
)

var (
	ErrUnapprovedITAMField = errors.New("unapproved ITAM field detected")
)

var ProhibitedITAMFields = map[string]struct{}{
	"cost":          {},
	"purchase_cost": {},
	"license_count": {},
	"warranty_end":  {},
	"vendor":        {},
}

// ValidateAntiITAM recursively checks a map or slice for any prohibited ITAM fields.
// If an unapproved field is found, it returns an error with the violating field name.
func ValidateAntiITAM(v interface{}) error {
	switch val := v.(type) {
	case map[string]interface{}:
		for k, child := range val {
			lowerKey := strings.ToLower(k)
			if _, prohibited := ProhibitedITAMFields[lowerKey]; prohibited {
				return fmt.Errorf("%w: '%s' is prohibited under strict Anti-ITAM governance", ErrUnapprovedITAMField, k)
			}
			if err := ValidateAntiITAM(child); err != nil {
				return err
			}
		}
	case []interface{}:
		for _, child := range val {
			if err := ValidateAntiITAM(child); err != nil {
				return err
			}
		}
	}
	return nil
}
