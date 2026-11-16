# Enterprise Configuration Management System (ETCMS) Workspace Makefile

SHELL := /bin/bash
BACKEND_DIR := etcms-backend
FRONTEND_DIR := etcms-frontend
DATABASE_URL ?= postgres://etcms:etcms_password@localhost:5432/etcms?sslmode=disable

.PHONY: help
help:
	@echo "======================================================================"
	@echo " Enterprise Configuration Management System (ETCMS)"
	@echo "======================================================================"
	@echo "Targets:"
	@echo "  make setup        - Install dependencies, run DB migrations, and apply seeds"
	@echo "  make dev          - Run backend (8080) and frontend (5173) concurrently"
	@echo "  make dev-backend  - Run Go backend API server on :8080"
	@echo "  make dev-frontend - Run Vite React frontend dev server on :5173"
	@echo "  make seed         - Re-apply realistic enterprise CMDB seed fixtures"
	@echo "  make test         - Run backend and frontend automated test suites"
	@echo "  make build        - Build backend binary and frontend static bundle"
	@echo "  make lint         - Run backend and frontend linters"
	@echo "======================================================================"

.PHONY: setup
setup:
	@echo "==> Setting up database schema..."
	$(MAKE) -C $(BACKEND_DIR) migrate-up DATABASE_URL="$(DATABASE_URL)"
	@echo "==> Applying seed fixtures..."
	$(MAKE) -C $(BACKEND_DIR) seed DATABASE_URL="$(DATABASE_URL)"
	@echo "==> Installing frontend dependencies..."
	cd $(FRONTEND_DIR) && bun install

.PHONY: seed
seed:
	$(MAKE) -C $(BACKEND_DIR) seed DATABASE_URL="$(DATABASE_URL)"

.PHONY: dev-backend
dev-backend:
	$(MAKE) -C $(BACKEND_DIR) migrate-up DATABASE_URL="$(DATABASE_URL)"
	cd $(BACKEND_DIR) && go run cmd/etcms-api/main.go

.PHONY: dev-frontend
dev-frontend:
	cd $(FRONTEND_DIR) && bun run dev

.PHONY: dev
dev:
	@echo "Starting backend and frontend..."
	$(MAKE) -C $(BACKEND_DIR) migrate-up DATABASE_URL="$(DATABASE_URL)"
	@trap 'kill 0' EXIT; \
	(cd $(BACKEND_DIR) && go run cmd/etcms-api/main.go) & \
	(cd $(FRONTEND_DIR) && bun run dev) & \
	wait

.PHONY: test
test:
	@echo "==> Running backend tests..."
	$(MAKE) -C $(BACKEND_DIR) test
	@echo "==> Running frontend tests..."
	cd $(FRONTEND_DIR) && bun run test

.PHONY: build
build:
	@echo "==> Building backend..."
	cd $(BACKEND_DIR) && go build -o etcms-api ./cmd/etcms-api
	@echo "==> Building frontend..."
	cd $(FRONTEND_DIR) && bun run build

.PHONY: lint
lint:
	@echo "==> Linting backend..."
	$(MAKE) -C $(BACKEND_DIR) lint
