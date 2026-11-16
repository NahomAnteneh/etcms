package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/org/etcms-backend/internal/domain"
)

// AntiITAM returns an HTTP middleware that inspects incoming JSON request bodies
// for any unapproved ITAM fields and immediately rejects them with 422 Unprocessable Entity.
func AntiITAM() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost || r.Method == http.MethodPatch || r.Method == http.MethodPut {
				contentType := r.Header.Get("Content-Type")
				if strings.Contains(contentType, "application/json") && r.Body != nil {
					bodyBytes, err := io.ReadAll(r.Body)
					if err != nil {
						next.ServeHTTP(w, r)
						return
					}
					// Restore body for downstream handlers
					r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

					if len(bodyBytes) > 0 {
						var parsed interface{}
						if err := json.Unmarshal(bodyBytes, &parsed); err == nil {
							if itamErr := domain.ValidateAntiITAM(parsed); itamErr != nil {
								WriteProblemDetails(w, http.StatusUnprocessableEntity, "Unprocessable Entity", itamErr.Error())
								return
							}
						}
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
