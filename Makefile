DATABASE_URL ?= postgres://etcms:etcms_password@localhost:5432/etcms?sslmode=disable
MIGRATIONS_DIR ?= migrations
OPENAPI_SPEC ?= api/openapi.yaml
BASE_SPEC ?= api/openapi.yaml

.PHONY: all
all: lint test

.PHONY: generate
generate:
	@if [ -f api/openapi.yaml ] && [ -f oapi-codegen.yaml ]; then \
		mkdir -p internal/adapters/http/gen && \
		oapi-codegen -config oapi-codegen.yaml api/openapi.yaml; \
	fi
	@if [ -f sqlc.yaml ]; then \
		mkdir -p internal/adapters/postgres/gen && \
		sqlc generate; \
	fi

.PHONY: migrate-up
migrate-up:
	goose -dir $(MIGRATIONS_DIR) postgres "$(DATABASE_URL)" up

.PHONY: migrate-down
migrate-down:
	goose -dir $(MIGRATIONS_DIR) postgres "$(DATABASE_URL)" down

.PHONY: lint
lint:
	golangci-lint run ./...

.PHONY: test
test:
	go test -v -race ./...

.PHONY: bench
bench:
	go test -bench=. -benchmem -run=^$$ ./...

.PHONY: diff-spec
diff-spec:
	@if command -v oasdiff >/dev/null 2>&1; then \
		oasdiff changelog $(BASE_SPEC) $(OPENAPI_SPEC); \
	else \
		echo "oasdiff not installed"; \
	fi
