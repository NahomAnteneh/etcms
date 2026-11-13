package http

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
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

	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.Recoverer)
	r.Use(auth.Middleware)

	server := handler.NewServer(store, version)
	strictHandler := gen.NewStrictHandler(server, nil)
	return gen.HandlerFromMux(strictHandler, r), nil
}
