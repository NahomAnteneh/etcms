package service

import (
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

// AuditCursor stores the cursor for keyset pagination of audit log entries.
type AuditCursor struct {
	CreatedAt time.Time `json:"t"`
	ID        uuid.UUID `json:"id"`
}

func encodeAuditCursor(t time.Time, id uuid.UUID) string {
	c := AuditCursor{CreatedAt: t, ID: id}
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeAuditCursor(raw string) (*AuditCursor, error) {
	if raw == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid audit cursor encoding", domain.ErrBadParam)
	}
	var c AuditCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("%w: invalid audit cursor payload", domain.ErrBadParam)
	}
	if c.ID == uuid.Nil {
		return nil, fmt.Errorf("%w: invalid cursor audit log ID", domain.ErrBadParam)
	}
	return &c, nil
}

// SanitizeCSVCell applies formula injection protection (AGENTS.md Rule 4.2).
// Any cell beginning with =, +, -, @, \t, or \r is prefixed with a single quote '.
func SanitizeCSVCell(val string) string {
	if len(val) > 0 {
		first := val[0]
		if first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r' {
			return "'" + val
		}
	}
	return val
}

// AuditService manages audit trails and streaming export.
type AuditService struct {
	store *postgres.Store
}

// NewAuditService creates a new AuditService instance.
func NewAuditService(store *postgres.Store) *AuditService {
	return &AuditService{store: store}
}

// GetCIAuditLogs retrieves a cursor-paginated timeline of audit log entries for a configuration item.
func (s *AuditService) GetCIAuditLogs(ctx context.Context, ciID uuid.UUID, params gen.GetCIAuditLogsParams) (*gen.CIAuditLogsResponse, error) {
	// 1. Verify CI exists
	_, err := s.store.Queries().GetCIByID(ctx, ciID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to fetch CI: %w", err)
	}

	limit := int32(20)
	if params.Limit != nil && *params.Limit > 0 {
		limit = int32(*params.Limit)
	}

	var hasCursor bool
	var lastCreatedAt time.Time
	var lastID uuid.UUID

	if params.Cursor != nil && *params.Cursor != "" {
		cur, err := decodeAuditCursor(*params.Cursor)
		if err != nil {
			return nil, err
		}
		if cur != nil {
			hasCursor = true
			lastCreatedAt = cur.CreatedAt
			lastID = cur.ID
		}
	}

	// Fetch limit + 1 to detect next cursor
	fetchLimit := limit + 1
	rows, err := s.store.Queries().GetCIAuditLogs(ctx, sqlcgen.GetCIAuditLogsParams{
		EntityID:      ciID,
		HasCursor:     hasCursor,
		LastCreatedAt: lastCreatedAt,
		LastID:        lastID,
		LimitVal:      fetchLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query CI audit logs: %w", err)
	}

	totalCount, err := s.store.Queries().CountCIAuditLogs(ctx, ciID)
	if err != nil {
		return nil, fmt.Errorf("failed to count CI audit logs: %w", err)
	}

	var nextCursor *string
	if int32(len(rows)) > limit {
		lastItem := rows[limit-1]
		enc := encodeAuditCursor(lastItem.CreatedAt, lastItem.ID)
		nextCursor = &enc
		rows = rows[:limit]
	}

	entries := make([]gen.AuditLogEntry, 0, len(rows))
	for _, r := range rows {
		var diffObj map[string]interface{}
		if len(r.Diff) > 0 {
			_ = json.Unmarshal(r.Diff, &diffObj)
		}
		if diffObj == nil {
			diffObj = make(map[string]interface{})
		}

		entries = append(entries, gen.AuditLogEntry{
			Id:                    r.ID,
			EntityType:            r.EntityType,
			EntityId:              r.EntityID,
			ActorId:               r.ActorID,
			ActorName:             r.ActorName,
			ActorEmail:            r.ActorEmail,
			Action:                string(r.Action),
			Diff:                  diffObj,
			AffectedOwnerGroupIds: r.AffectedOwnerGroupIds,
			CreatedAt:             r.CreatedAt,
		})
	}

	return &gen.CIAuditLogsResponse{
		Items:      entries,
		Total:      int(totalCount),
		NextCursor: nextCursor,
	}, nil
}

// ExportAuditLogs streams audit log entries under REPEATABLE READ snapshot isolation with formula injection protection.
func (s *AuditService) ExportAuditLogs(ctx context.Context, actor *domain.Actor, params gen.ExportAuditLogsParams) (io.Reader, string, string, error) {
	// Authorization check
	var groupFilter uuid.UUID
	if params.OwnerGroupId != nil && *params.OwnerGroupId != uuid.Nil {
		groupFilter = *params.OwnerGroupId
		if !actor.BelongsToOwnerGroup(groupFilter) {
			return nil, "", "", fmt.Errorf("%w: user does not belong to owner group %s", domain.ErrForbidden, groupFilter)
		}
	} else {
		if !actor.HasRole(domain.RolePlatformAdmin) {
			return nil, "", "", fmt.Errorf("%w: global audit export is strictly restricted to platform_admin", domain.ErrForbidden)
		}
	}

	isNDJSON := params.Format != nil && *params.Format == gen.Ndjson

	// Begin RepeatableRead transaction snapshot
	tx, err := s.store.Pool().BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to start repeatable read snapshot: %w", err)
	}

	var fromTime time.Time
	if params.From != nil {
		fromTime = *params.From
	}
	var toTime time.Time
	if params.To != nil {
		toTime = *params.To
	}

	q := sqlcgen.New(tx)
	rows, err := q.ExportAuditLogs(ctx, sqlcgen.ExportAuditLogsParams{
		OwnerGroupID: groupFilter,
		FromTime:     fromTime,
		ToTime:       toTime,
	})
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, "", "", fmt.Errorf("failed to export audit logs: %w", err)
	}

	pr, pw := io.Pipe()

	contentType := "text/csv"
	contentDisposition := "attachment; filename=\"audit-logs.csv\""
	if isNDJSON {
		contentType = "application/x-ndjson"
		contentDisposition = "attachment; filename=\"audit-logs.ndjson\""
	}

	go func() {
		defer func() { _ = tx.Rollback(ctx) }() // Read-only snapshot cleanup

		if isNDJSON {
			defer pw.Close()
			for _, r := range rows {
				var diffObj map[string]interface{}
				if len(r.Diff) > 0 {
					_ = json.Unmarshal(r.Diff, &diffObj)
				}
				if diffObj == nil {
					diffObj = make(map[string]interface{})
				}

				entry := map[string]interface{}{
					"id":                       r.ID.String(),
					"entity_type":              r.EntityType,
					"entity_id":                r.EntityID.String(),
					"actor_id":                 r.ActorID.String(),
					"actor_name":               r.ActorName,
					"actor_email":              r.ActorEmail,
					"action":                   r.Action,
					"diff":                     diffObj,
					"affected_owner_group_ids": r.AffectedOwnerGroupIds,
					"created_at":               r.CreatedAt.Format(time.RFC3339Nano),
				}
				b, mErr := json.Marshal(entry)
				if mErr != nil {
					_ = pw.CloseWithError(mErr)
					return
				}
				b = append(b, '\n')
				if _, wErr := pw.Write(b); wErr != nil {
					_ = pw.CloseWithError(wErr)
					return
				}
			}
		} else {
			csvWriter := csv.NewWriter(pw)
			header := []string{
				"id",
				"created_at",
				"action",
				"entity_type",
				"entity_id",
				"actor_id",
				"actor_name",
				"actor_email",
				"affected_owner_group_ids",
				"diff",
			}
			if err := csvWriter.Write(header); err != nil {
				_ = pw.CloseWithError(err)
				return
			}

			for _, r := range rows {
				groupIDs := make([]string, len(r.AffectedOwnerGroupIds))
				for i, gid := range r.AffectedOwnerGroupIds {
					groupIDs[i] = gid.String()
				}
				groupsStr := strings.Join(groupIDs, ";")

				diffStr := string(r.Diff)

				record := []string{
					SanitizeCSVCell(r.ID.String()),
					SanitizeCSVCell(r.CreatedAt.Format(time.RFC3339Nano)),
					SanitizeCSVCell(string(r.Action)),
					SanitizeCSVCell(r.EntityType),
					SanitizeCSVCell(r.EntityID.String()),
					SanitizeCSVCell(r.ActorID.String()),
					SanitizeCSVCell(r.ActorName),
					SanitizeCSVCell(r.ActorEmail),
					SanitizeCSVCell(groupsStr),
					SanitizeCSVCell(diffStr),
				}
				if err := csvWriter.Write(record); err != nil {
					_ = pw.CloseWithError(err)
					return
				}
			}
			csvWriter.Flush()
			_ = pw.CloseWithError(csvWriter.Error())
		}
	}()

	return pr, contentType, contentDisposition, nil
}
