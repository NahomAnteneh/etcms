package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// MetricsRegistry stores in-memory Prometheus counters and histograms.
type MetricsRegistry struct {
	mu           sync.RWMutex
	requests     map[string]*uint64
	durationBuck map[string][]uint64 // method+path -> counts in buckets
	version      string
}

var (
	// Buckets in seconds: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
	buckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0}
	globalRegistry *MetricsRegistry
	registryOnce   sync.Once
)

// GetMetricsRegistry returns the singleton metrics registry.
func GetMetricsRegistry(version string) *MetricsRegistry {
	registryOnce.Do(func() {
		globalRegistry = &MetricsRegistry{
			requests:     make(map[string]*uint64),
			durationBuck: make(map[string][]uint64),
			version:      version,
		}
	})
	return globalRegistry
}

// RecordRequest increments the request counter and duration histogram.
func (reg *MetricsRegistry) RecordRequest(method, path string, status int, duration time.Duration) {
	// Normalize path by removing UUIDs/IDs to avoid cardinality explosion
	normPath := normalizePath(path)

	key := fmt.Sprintf(`method="%s",path="%s",status="%d"`, method, normPath, status)

	reg.mu.Lock()
	counter, exists := reg.requests[key]
	if !exists {
		var val uint64
		counter = &val
		reg.requests[key] = counter
	}
	reg.mu.Unlock()

	atomic.AddUint64(counter, 1)

	sec := duration.Seconds()
	histKey := fmt.Sprintf(`method="%s",path="%s"`, method, normPath)

	reg.mu.Lock()
	bList, bExists := reg.durationBuck[histKey]
	if !bExists {
		bList = make([]uint64, len(buckets)+1)
		reg.durationBuck[histKey] = bList
	}
	for i, b := range buckets {
		if sec <= b {
			bList[i]++
		}
	}
	bList[len(buckets)]++ // +Inf
	reg.mu.Unlock()
}

func normalizePath(path string) string {
	parts := strings.Split(path, "/")
	for i, p := range parts {
		if len(p) == 36 && strings.Count(p, "-") == 4 { // UUID
			parts[i] = "{id}"
		} else if len(p) >= 32 && isHex(p) { // Token or hash
			parts[i] = "{token}"
		}
	}
	return strings.Join(parts, "/")
}

func isHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// Handler returns an http.Handler that exports Prometheus text format metrics.
func (reg *MetricsRegistry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reg.mu.RLock()
		defer reg.mu.RUnlock()

		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

		var b strings.Builder
		b.WriteString("# HELP etcms_info Build and version metadata.\n")
		b.WriteString("# TYPE etcms_info gauge\n")
		b.WriteString(fmt.Sprintf("etcms_info{version=\"%s\"} 1\n\n", reg.version))

		b.WriteString("# HELP http_requests_total Total number of HTTP requests processed.\n")
		b.WriteString("# TYPE http_requests_total counter\n")
		for label, counter := range reg.requests {
			b.WriteString(fmt.Sprintf("http_requests_total{%s} %d\n", label, atomic.LoadUint64(counter)))
		}

		b.WriteString("\n# HELP http_request_duration_seconds HTTP request latencies in seconds.\n")
		b.WriteString("# TYPE http_request_duration_seconds histogram\n")
		for label, counts := range reg.durationBuck {
			for i, buck := range buckets {
				b.WriteString(fmt.Sprintf("http_request_duration_seconds_bucket{%s,le=\"%s\"} %d\n", label, strconv.FormatFloat(buck, 'f', -1, 64), counts[i]))
			}
			b.WriteString(fmt.Sprintf("http_request_duration_seconds_bucket{%s,le=\"+Inf\"} %d\n", label, counts[len(buckets)]))
			b.WriteString(fmt.Sprintf("http_request_duration_seconds_count{%s} %d\n", label, counts[len(buckets)]))
		}

		_, _ = w.Write([]byte(b.String()))
	})
}

// MetricsCollector middleware records Prometheus request metrics.
func MetricsCollector(reg *MetricsRegistry) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/v1/metrics" {
				reg.Handler().ServeHTTP(w, r)
				return
			}

			start := time.Now()
			ww := &responseWriterInterceptor{ResponseWriter: w, statusCode: http.StatusOK}

			next.ServeHTTP(ww, r)

			reg.RecordRequest(r.Method, r.URL.Path, ww.statusCode, time.Since(start))
		})
	}
}
