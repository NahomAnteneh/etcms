package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// clientLimiter tracks rate limiters per IP.
type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// IPRateLimiter provides thread-safe IP-keyed token-bucket rate limiting.
type IPRateLimiter struct {
	mu      sync.Mutex
	clients map[string]*clientLimiter
	r       rate.Limit
	b       int
}

// NewIPRateLimiter constructs a new IP rate limiter with cleanup of stale visitors.
func NewIPRateLimiter(r rate.Limit, b int) *IPRateLimiter {
	limiter := &IPRateLimiter{
		clients: make(map[string]*clientLimiter),
		r:       r,
		b:       b,
	}

	// Clean up stale IP records every 5 minutes
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			limiter.mu.Lock()
			for ip, client := range limiter.clients {
				if time.Since(client.lastSeen) > 10*time.Minute {
					delete(limiter.clients, ip)
				}
			}
			limiter.mu.Unlock()
		}
	}()

	return limiter
}

// GetLimiter returns or creates the rate.Limiter for a given IP.
func (i *IPRateLimiter) GetLimiter(ip string) *rate.Limiter {
	i.mu.Lock()
	defer i.mu.Unlock()

	client, exists := i.clients[ip]
	if !exists {
		l := rate.NewLimiter(i.r, i.b)
		i.clients[ip] = &clientLimiter{limiter: l, lastSeen: time.Now()}
		return l
	}

	client.lastSeen = time.Now()
	return client.limiter
}

// RateLimit returns HTTP middleware enforcing rate limits for sensitive routes.
// - /api/v1/auth/login: max 10 requests per minute with burst of 10 per IP
// - /api/v1/intake/*: max 30 requests per minute with burst of 30 per IP
func RateLimit(enabled bool) func(http.Handler) http.Handler {
	if !enabled {
		return func(next http.Handler) http.Handler {
			return next
		}
	}

	loginLimiter := NewIPRateLimiter(rate.Every(6*time.Second), 10)  // 10 req/min
	intakeLimiter := NewIPRateLimiter(rate.Every(2*time.Second), 30) // 30 req/min

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path

			var limiter *rate.Limiter
			clientIP := r.RemoteAddr
			if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				parts := strings.Split(forwarded, ",")
				clientIP = strings.TrimSpace(parts[0])
			}

			if strings.HasSuffix(path, "/auth/login") {
				limiter = loginLimiter.GetLimiter(clientIP)
			} else if strings.Contains(path, "/intake/") {
				limiter = intakeLimiter.GetLimiter(clientIP)
			}

			if limiter != nil && !limiter.Allow() {
				WriteProblemDetails(w, http.StatusTooManyRequests, "Too Many Requests", "Rate limit exceeded. Please wait before retrying.")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
