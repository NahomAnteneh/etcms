package http

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/http/handler"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
)

// NewRouter constructs the Chi HTTP router wired with middleware and OpenAPI routes.
func NewRouter(store *postgres.Store, authConfig middleware.AuthConfig, version string) (http.Handler, error) {
	auth, err := middleware.NewAuthenticator(authConfig, store)
	if err != nil {
		return nil, err
	}

	allowedOrigins := []string{"http://localhost:*", "http://127.0.0.1:*"}
	if envOrigins := os.Getenv("ALLOWED_ORIGINS"); envOrigins != "" {
		allowedOrigins = nil
		for _, o := range strings.Split(envOrigins, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
	}

	metricsReg := middleware.GetMetricsRegistry(version)

	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(middleware.RequestLogger(slog.Default()))
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.MetricsCollector(metricsReg))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Dev-User-ID", "X-Intake-Token", "If-Match", "Idempotency-Key"},
		ExposedHeaders:   []string{"ETag", "Link", "Content-Disposition"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RateLimit(authConfig.AppEnv != "test"))
	r.Use(middleware.MaxBodySize(2 * 1024 * 1024))
	r.Use(middleware.AntiITAM())
	r.Use(auth.Middleware)

	server := handler.NewServer(store, version)

	strictHandler := gen.NewStrictHandlerWithOptions(server, nil, gen.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) || strings.Contains(err.Error(), "request body too large") {
				middleware.WriteProblemDetails(w, http.StatusRequestEntityTooLarge, "Payload Too Large", "Request body exceeds maximum allowed size of 2MB")
				return
			}
			middleware.WriteProblemDetails(w, http.StatusBadRequest, "Bad Request", err.Error())
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			middleware.WriteProblemDetails(w, http.StatusInternalServerError, "Internal Server Error", "An unexpected error occurred")
		},
	})
	return gen.HandlerFromMux(strictHandler, r), nil
}
