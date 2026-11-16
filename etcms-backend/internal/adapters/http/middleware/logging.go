package middleware

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

// responseWriterInterceptor intercepts HTTP status code and response size.
type responseWriterInterceptor struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int
}

func (w *responseWriterInterceptor) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *responseWriterInterceptor) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytesWritten += n
	return n, err
}

// RequestLogger provides high-performance structured HTTP access logging via slog.
func RequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Skip logging high-frequency liveness probes to prevent noise
			if r.URL.Path == "/api/v1/healthz" {
				next.ServeHTTP(w, r)
				return
			}

			ww := &responseWriterInterceptor{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
			}

			next.ServeHTTP(ww, r)

			duration := time.Since(start)

			reqID := chimiddleware.GetReqID(r.Context())
			clientIP := r.RemoteAddr
			if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				parts := strings.Split(forwarded, ",")
				clientIP = strings.TrimSpace(parts[0])
			}

			level := slog.LevelInfo
			if ww.statusCode >= 500 {
				level = slog.LevelError
			} else if ww.statusCode >= 400 {
				level = slog.LevelWarn
			}

			logger.Log(r.Context(), level, "http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.statusCode,
				"duration_ms", duration.Milliseconds(),
				"bytes", ww.bytesWritten,
				"client_ip", clientIP,
				"request_id", reqID,
				"user_agent", r.UserAgent(),
			)
		})
	}
}
