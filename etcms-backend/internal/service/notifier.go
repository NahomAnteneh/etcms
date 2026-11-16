package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// DigestNotificationPayload represents the structured webhook payload sent to DIGEST_WEBHOOK_URL.
type DigestNotificationPayload struct {
	CycleID        uuid.UUID           `json:"cycle_id"`
	OwnerGroupID   uuid.UUID           `json:"owner_group_id"`
	OwnerGroupName string              `json:"owner_group_name"`
	TeamLeadEmail  string              `json:"team_lead_email"`
	WindowStart    time.Time           `json:"window_start"`
	WindowEnd      time.Time           `json:"window_end"`
	TotalItems     int                 `json:"total_items"`
	TriggerCounts  map[string]int      `json:"trigger_counts"`
	Items          []DigestSummaryItem `json:"items"`
}

// DigestSummaryItem represents a single item inside the digest notification summary.
type DigestSummaryItem struct {
	CIID          uuid.UUID `json:"ci_id"`
	CIName        string    `json:"ci_name"`
	TriggerReason string    `json:"trigger_reason"`
}

// Notifier defines the interface for dispatching digest cycle notifications.
type Notifier interface {
	NotifyDigestCycle(ctx context.Context, payload DigestNotificationPayload) error
}

// WebhookNotifier dispatches digest notifications via HTTP POST to a configured URL.
type WebhookNotifier struct {
	webhookURL string
	httpClient *http.Client
}

// NewWebhookNotifier creates a WebhookNotifier with the specified webhook URL.
func NewWebhookNotifier(webhookURL string, httpClient *http.Client) *WebhookNotifier {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &WebhookNotifier{
		webhookURL: webhookURL,
		httpClient: httpClient,
	}
}

// NotifyDigestCycle sends the digest payload to the configured webhook URL.
func (n *WebhookNotifier) NotifyDigestCycle(ctx context.Context, payload DigestNotificationPayload) error {
	if n.webhookURL == "" {
		return nil
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal digest notification payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := n.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to dispatch webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned non-2xx status code: %d", resp.StatusCode)
	}

	return nil
}

// NoopNotifier is a no-op implementation of Notifier when notifications are disabled.
type NoopNotifier struct{}

// NotifyDigestCycle is a no-op.
func (n *NoopNotifier) NotifyDigestCycle(ctx context.Context, payload DigestNotificationPayload) error {
	return nil
}
