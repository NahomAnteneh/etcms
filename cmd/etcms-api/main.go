package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jackc/pgx/v5/stdlib"
	goose "github.com/pressly/goose/v3"
	"golang.org/x/crypto/bcrypt"

	adapterhttp "github.com/org/etcms-backend/internal/adapters/http"
	"github.com/org/etcms-backend/internal/adapters/http/middleware"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	"github.com/org/etcms-backend/migrations"
)

func generateRandomPassword(length int) (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	for i, b := range bytes {
		bytes[i] = charset[int(b)%len(charset)]
	}
	return string(bytes), nil
}

const legacyPlaceholderHash = "$2a$10$lVcn556r5.FeIC8crM7.3uE8hhPZRl1Y4j3HX5TxuA74U623njo7O"

func ensureAdminUser(ctx context.Context, pool *pgxpool.Pool, logger *slog.Logger) error {
	var count int
	err := pool.QueryRow(ctx, "SELECT count(*) FROM users WHERE email = 'admin@enterprise.com'").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check existing admin: %w", err)
	}

	var passwordHash string
	if count > 0 {
		_ = pool.QueryRow(ctx, "SELECT password_hash FROM users WHERE email = 'admin@enterprise.com'").Scan(&passwordHash)
	}

	// If admin already has a valid non-empty password that is NOT the legacy migration placeholder,
	// and not forced to regenerate, do nothing
	if count > 0 && passwordHash != "" && passwordHash != legacyPlaceholderHash && os.Getenv("GENERATE_ADMIN_PASSWORD") != "true" && os.Getenv("INITIAL_ADMIN_PASSWORD") == "" {
		return nil
	}

	rawPassword := os.Getenv("INITIAL_ADMIN_PASSWORD")
	isGenerated := false
	if rawPassword == "" {
		var gErr error
		rawPassword, gErr = generateRandomPassword(16)
		if gErr != nil {
			return fmt.Errorf("failed to generate random admin password: %w", gErr)
		}
		isGenerated = true
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(rawPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash admin password: %w", err)
	}

	if count == 0 {
		// Insert bootstrap admin
		_, err = pool.Exec(ctx, `
			INSERT INTO users (id, email, name, role, primary_owner_group_id, custom_role_id, password_hash, status, created_at, updated_at)
			VALUES (
				'11111111-1111-1111-1111-111111111111',
				'admin@enterprise.com',
				'Admin User',
				'platform_admin',
				(SELECT id FROM owner_groups WHERE id = '10000000-0000-0000-0000-000000000001' LIMIT 1),
				(SELECT id FROM custom_roles WHERE id = 'c0000000-0000-0000-0000-000000000001' OR name = 'Platform Administrator' LIMIT 1),
				$1,
				'active',
				now(),
				now()
			)
			ON CONFLICT (id) DO UPDATE SET password_hash = $1, status = 'active'
		`, string(hashed))
		if err != nil {
			return fmt.Errorf("failed to insert initial admin: %w", err)
		}
	} else {
		// Update admin password
		_, err = pool.Exec(ctx, "UPDATE users SET password_hash = $1, status = 'active', updated_at = now() WHERE email = 'admin@enterprise.com'", string(hashed))
		if err != nil {
			return fmt.Errorf("failed to update admin password: %w", err)
		}
	}

	if isGenerated {
		banner := fmt.Sprintf(`
================================================================================
 INITIAL PLATFORM ADMINISTRATOR PROVISIONED
 Email:    admin@enterprise.com
 Password: %s
 NOTE: Store this generated password securely and change it upon first login.
================================================================================
`, rawPassword)
		fmt.Fprint(os.Stdout, banner)
		logger.Info("initial platform administrator credentials generated", "email", "admin@enterprise.com", "password", rawPassword)
	} else {
		logger.Info("initial platform administrator password configured from INITIAL_ADMIN_PASSWORD environment variable", "email", "admin@enterprise.com")
	}

	return nil
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	appEnv := os.Getenv("APP_ENV")
	if appEnv == "" {
		appEnv = "development"
	}

	allowDevAuth := true
	if val := os.Getenv("ALLOW_DEV_AUTH_HEADER"); val != "" {
		allowDevAuth = (val == "true")
	} else if appEnv != "development" && appEnv != "test" {
		allowDevAuth = false
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://etcms:etcms_password@localhost:5432/etcms?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		logger.Error("failed to parse database URL", "error", err)
		os.Exit(1)
	}

	poolConfig.MaxConns = 25
	if val := os.Getenv("DB_MAX_CONNS"); val != "" {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			poolConfig.MaxConns = int32(n)
		}
	}
	poolConfig.MinConns = 5
	if val := os.Getenv("DB_MIN_CONNS"); val != "" {
		if n, err := strconv.Atoi(val); err == nil && n > 0 {
			poolConfig.MinConns = int32(n)
		}
	}
	poolConfig.MaxConnLifetime = 1 * time.Hour
	poolConfig.MaxConnIdleTime = 15 * time.Minute
	poolConfig.HealthCheckPeriod = 1 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		logger.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Apply pending goose database migrations automatically if enabled
	autoMigrate := os.Getenv("AUTO_MIGRATE") == "true" || appEnv == "development" || appEnv == "test"
	if autoMigrate {
		stdDB := stdlib.OpenDBFromPool(pool)
		if err := goose.SetDialect("postgres"); err != nil {
			logger.Error("failed to set goose dialect", "error", err)
			os.Exit(1)
		}

		migDir := os.Getenv("MIGRATIONS_DIR")
		if migDir != "" {
			goose.SetBaseFS(nil)
			if err := goose.Up(stdDB, migDir); err != nil {
				logger.Error("failed to apply database migrations from MIGRATIONS_DIR", "dir", migDir, "error", err)
				os.Exit(1)
			}
			logger.Info("database schema migrations applied successfully from MIGRATIONS_DIR", "dir", migDir)
		} else {
			goose.SetBaseFS(migrations.FS)
			if err := goose.Up(stdDB, "."); err != nil {
				logger.Error("failed to apply embedded database migrations", "error", err)
				os.Exit(1)
			}
			logger.Info("embedded database schema migrations applied successfully")
			goose.SetBaseFS(nil)
		}
		_ = stdDB.Close()
	} else {
		logger.Info("database auto-migration is disabled (AUTO_MIGRATE=false); skipping startup migrations")
	}

	// Ensure bootstrap platform administrator exists with random or configured credentials
	if err := ensureAdminUser(context.Background(), pool, logger); err != nil {
		logger.Warn("could not ensure initial admin user", "error", err)
	}

	store := postgres.NewStore(pool)
	authCfg := middleware.AuthConfig{
		AppEnv:             appEnv,
		AllowDevAuthHeader: allowDevAuth,
	}

	router, err := adapterhttp.NewRouter(store, authCfg, "3.0.0")
	if err != nil {
		logger.Error("failed to initialize router", "error", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("starting etcms-api server", "port", port, "env", appEnv)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("error during server shutdown", "error", err)
	}
	logger.Info("etcms-api stopped cleanly")
}
