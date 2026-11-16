package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	gen "github.com/org/etcms-backend/internal/adapters/http/gen"
	"github.com/org/etcms-backend/internal/adapters/postgres"
	sqlcgen "github.com/org/etcms-backend/internal/adapters/postgres/gen"
	"github.com/org/etcms-backend/internal/domain"
)

// AdminManagementService handles Owner Groups and CI Class administration.
type AdminManagementService struct {
	store *postgres.Store
}

// NewAdminManagementService creates a new AdminManagementService.
func NewAdminManagementService(store *postgres.Store) *AdminManagementService {
	return &AdminManagementService{store: store}
}

// OwnerGroupDTO represents an owner group in API responses.
type OwnerGroupDTO struct {
	ID             uuid.UUID `json:"id"`
	Name           string    `json:"name"`
	Slug           string    `json:"slug"`
	DepartmentName string    `json:"department_name"`
	TeamLeadName   string    `json:"team_lead_name"`
	TeamLeadEmail  string    `json:"team_lead_email"`
	CreatedAt      time.Time `json:"created_at"`
}

// CreateOwnerGroupRequestDTO represents payload to create an owner group.
type CreateOwnerGroupRequestDTO struct {
	Name           string `json:"name"`
	Slug           string `json:"slug"`
	DepartmentName string `json:"department_name"`
	TeamLeadName   string `json:"team_lead_name"`
	TeamLeadEmail  string `json:"team_lead_email"`
}

// UpdateOwnerGroupRequestDTO represents payload to update an owner group.
type UpdateOwnerGroupRequestDTO struct {
	Name           string `json:"name"`
	Slug           string `json:"slug"`
	DepartmentName string `json:"department_name"`
	TeamLeadName   string `json:"team_lead_name"`
	TeamLeadEmail  string `json:"team_lead_email"`
}

// CIClassDTO represents a CI class in API responses.
type CIClassDTO struct {
	ID          string             `json:"id"`
	Label       string             `json:"label"`
	Category    string             `json:"category"`
	Description string             `json:"description"`
	Icon        string             `json:"icon"`
	IsSystem    bool               `json:"is_system"`
	Attributes  []string           `json:"attributes"`
	FormFields  []gen.CIFormField  `json:"form_fields"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

// CreateCIClassRequestDTO represents payload to create a custom CI class.
type CreateCIClassRequestDTO struct {
	ID          string            `json:"id"`
	Label       string            `json:"label"`
	Category    string            `json:"category"`
	Description string            `json:"description"`
	Icon        string            `json:"icon"`
	Attributes  []string          `json:"attributes"`
	FormFields  []gen.CIFormField `json:"form_fields"`
}

// UpdateCIClassRequestDTO represents payload to update an existing CI class.
type UpdateCIClassRequestDTO struct {
	Label       string            `json:"label"`
	Category    string            `json:"category"`
	Description string            `json:"description"`
	Icon        string            `json:"icon"`
	Attributes  []string          `json:"attributes"`
	FormFields  []gen.CIFormField `json:"form_fields"`
}

// CategoryDTO represents a CI category in API responses.
type CategoryDTO struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	Color       string    `json:"color"`
	ClassCount  int64     `json:"class_count"`
	CICount     int64     `json:"ci_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CreateCategoryRequestDTO represents payload to create a custom category.
type CreateCategoryRequestDTO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
}

// UpdateCategoryRequestDTO represents payload to update a custom category.
type UpdateCategoryRequestDTO struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
}

// RelationshipTypeDTO represents a relationship type in API responses.
type RelationshipTypeDTO struct {
	ID           string    `json:"id"`
	Label        string    `json:"label"`
	ReverseLabel string    `json:"reverse_label"`
	Description  string    `json:"description"`
	Color        string    `json:"color"`
	EdgeCount    int64     `json:"edge_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// CreateRelationshipTypeRequestDTO represents payload to create a custom relationship type.
type CreateRelationshipTypeRequestDTO struct {
	ID           string `json:"id"`
	Label        string `json:"label"`
	ReverseLabel string `json:"reverse_label"`
	Description  string `json:"description"`
	Color        string `json:"color"`
}

// UpdateRelationshipTypeRequestDTO represents payload to update a custom relationship type.
type UpdateRelationshipTypeRequestDTO struct {
	Label        string `json:"label"`
	ReverseLabel string `json:"reverse_label"`
	Description  string `json:"description"`
	Color        string `json:"color"`
}

// slugify converts a string to a URL-friendly slug.
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var out []rune
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			out = append(out, r)
		} else if len(out) > 0 && out[len(out)-1] != '-' {
			out = append(out, '-')
		}
	}
	return strings.Trim(string(out), "-")
}

// CreateOwnerGroup registers a new owner group in the CMDB.
func (s *AdminManagementService) CreateOwnerGroup(ctx context.Context, actor *domain.Actor, req CreateOwnerGroupRequestDTO) (*OwnerGroupDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: owner group creation requires platform_admin", domain.ErrForbidden)
	}

	if strings.TrimSpace(req.Name) == "" {
		return nil, fmt.Errorf("%w: group name is required", domain.ErrBadParam)
	}
	if strings.TrimSpace(req.DepartmentName) == "" {
		return nil, fmt.Errorf("%w: department name is required", domain.ErrBadParam)
	}
	if strings.TrimSpace(req.TeamLeadName) == "" || strings.TrimSpace(req.TeamLeadEmail) == "" {
		return nil, fmt.Errorf("%w: team lead name and email are required", domain.ErrBadParam)
	}

	slug := req.Slug
	if strings.TrimSpace(slug) == "" {
		slug = slugify(req.Name)
	}

	row, err := s.store.Queries().CreateOwnerGroup(ctx, sqlcgen.CreateOwnerGroupParams{
		ID:             uuid.New(),
		Name:           strings.TrimSpace(req.Name),
		Slug:           slug,
		DepartmentName: strings.TrimSpace(req.DepartmentName),
		TeamLeadName:   strings.TrimSpace(req.TeamLeadName),
		TeamLeadEmail:  strings.TrimSpace(req.TeamLeadEmail),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create owner group: %w", err)
	}

	return &OwnerGroupDTO{
		ID:             row.ID,
		Name:           row.Name,
		Slug:           row.Slug,
		DepartmentName: row.DepartmentName,
		TeamLeadName:   row.TeamLeadName,
		TeamLeadEmail:  row.TeamLeadEmail,
		CreatedAt:      row.CreatedAt,
	}, nil
}

// UpdateOwnerGroup updates metadata of an existing owner group.
func (s *AdminManagementService) UpdateOwnerGroup(ctx context.Context, actor *domain.Actor, groupID uuid.UUID, req UpdateOwnerGroupRequestDTO) (*OwnerGroupDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: owner group update requires platform_admin", domain.ErrForbidden)
	}

	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.DepartmentName) == "" {
		return nil, fmt.Errorf("%w: name and department are required", domain.ErrBadParam)
	}

	slug := req.Slug
	if strings.TrimSpace(slug) == "" {
		slug = slugify(req.Name)
	}

	row, err := s.store.Queries().UpdateOwnerGroup(ctx, sqlcgen.UpdateOwnerGroupParams{
		ID:             groupID,
		Name:           strings.TrimSpace(req.Name),
		Slug:           slug,
		DepartmentName: strings.TrimSpace(req.DepartmentName),
		TeamLeadName:   strings.TrimSpace(req.TeamLeadName),
		TeamLeadEmail:  strings.TrimSpace(req.TeamLeadEmail),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: owner group not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to update owner group: %w", err)
	}

	return &OwnerGroupDTO{
		ID:             row.ID,
		Name:           row.Name,
		Slug:           row.Slug,
		DepartmentName: row.DepartmentName,
		TeamLeadName:   row.TeamLeadName,
		TeamLeadEmail:  row.TeamLeadEmail,
		CreatedAt:      row.CreatedAt,
	}, nil
}

// DeleteOwnerGroup removes an owner group if it has no linked CIs.
func (s *AdminManagementService) DeleteOwnerGroup(ctx context.Context, actor *domain.Actor, groupID uuid.UUID) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: owner group deletion requires platform_admin", domain.ErrForbidden)
	}

	if err := s.store.Queries().DeleteOwnerGroup(ctx, groupID); err != nil {
		return fmt.Errorf("%w: cannot delete owner group; it may have linked CIs or users", domain.ErrBadParam)
	}
	return nil
}

// ListCIClasses returns all system and custom CI classes.
func (s *AdminManagementService) ListCIClasses(ctx context.Context) ([]CIClassDTO, error) {
	rows, err := s.store.Queries().ListCIClasses(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list CI classes: %w", err)
	}

	classes := make([]CIClassDTO, 0, len(rows))
	for _, r := range rows {
		fields := make([]gen.CIFormField, 0)
		if len(r.FormFields) > 0 {
			_ = json.Unmarshal(r.FormFields, &fields)
		}
		classes = append(classes, CIClassDTO{
			ID:          r.ID,
			Label:       r.Label,
			Category:    r.Category,
			Description: r.Description,
			Icon:        r.Icon,
			IsSystem:    r.IsSystem,
			Attributes:  r.Attributes,
			FormFields:  fields,
			CreatedAt:   r.CreatedAt,
			UpdatedAt:   r.UpdatedAt,
		})
	}
	return classes, nil
}

// CreateCIClass registers a new custom CI class.
func (s *AdminManagementService) CreateCIClass(ctx context.Context, actor *domain.Actor, req CreateCIClassRequestDTO) (*CIClassDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: CI class creation requires platform_admin", domain.ErrForbidden)
	}

	id := strings.ToLower(strings.TrimSpace(req.ID))
	id = strings.ReplaceAll(id, "-", "_")
	if id == "" {
		return nil, fmt.Errorf("%w: class identifier is required", domain.ErrBadParam)
	}
	if strings.TrimSpace(req.Label) == "" {
		return nil, fmt.Errorf("%w: class label is required", domain.ErrBadParam)
	}

	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = "Application"
	}
	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "Layers"
	}

	attrs := req.Attributes
	if attrs == nil {
		attrs = []string{}
	}

	fields := req.FormFields
	if fields == nil {
		fields = []gen.CIFormField{}
	}
	formFieldsJSON, err := json.Marshal(fields)
	if err != nil {
		formFieldsJSON = []byte("[]")
	}

	row, err := s.store.Queries().CreateCIClass(ctx, sqlcgen.CreateCIClassParams{
		ID:          id,
		Label:       strings.TrimSpace(req.Label),
		Category:    category,
		Description: strings.TrimSpace(req.Description),
		Icon:        icon,
		IsSystem:    false,
		Attributes:  attrs,
		FormFields:  formFieldsJSON,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create CI class: %w", err)
	}

	respFields := make([]gen.CIFormField, 0)
	if len(row.FormFields) > 0 {
		_ = json.Unmarshal(row.FormFields, &respFields)
	}

	return &CIClassDTO{
		ID:          row.ID,
		Label:       row.Label,
		Category:    row.Category,
		Description: row.Description,
		Icon:        row.Icon,
		IsSystem:    row.IsSystem,
		Attributes:  row.Attributes,
		FormFields:  respFields,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}, nil
}

// UpdateCIClass updates a custom CI class definition.
func (s *AdminManagementService) UpdateCIClass(ctx context.Context, actor *domain.Actor, classID string, req UpdateCIClassRequestDTO) (*CIClassDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: CI class update requires platform_admin", domain.ErrForbidden)
	}

	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = "Application"
	}
	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "Layers"
	}
	attrs := req.Attributes
	if attrs == nil {
		attrs = []string{}
	}

	fields := req.FormFields
	if fields == nil {
		fields = []gen.CIFormField{}
	}
	formFieldsJSON, err := json.Marshal(fields)
	if err != nil {
		formFieldsJSON = []byte("[]")
	}

	row, err := s.store.Queries().UpdateCIClass(ctx, sqlcgen.UpdateCIClassParams{
		ID:          classID,
		Label:       strings.TrimSpace(req.Label),
		Category:    category,
		Description: strings.TrimSpace(req.Description),
		Icon:        icon,
		Attributes:  attrs,
		FormFields:  formFieldsJSON,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: CI class not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to update CI class: %w", err)
	}

	respFields := make([]gen.CIFormField, 0)
	if len(row.FormFields) > 0 {
		_ = json.Unmarshal(row.FormFields, &respFields)
	}

	return &CIClassDTO{
		ID:          row.ID,
		Label:       row.Label,
		Category:    row.Category,
		Description: row.Description,
		Icon:        row.Icon,
		IsSystem:    row.IsSystem,
		Attributes:  row.Attributes,
		FormFields:  respFields,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}, nil
}

// DeleteCIClass deletes a custom CI class.
func (s *AdminManagementService) DeleteCIClass(ctx context.Context, actor *domain.Actor, classID string) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: CI class deletion requires platform_admin", domain.ErrForbidden)
	}

	ciCount, err := s.store.Queries().CountCIsByClass(ctx, classID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("failed to check CI class usage: %w", err)
	}
	if ciCount > 0 {
		return fmt.Errorf("%w: cannot delete CI class %q: %d active CI(s) belong to this class", domain.ErrConflict, classID, ciCount)
	}

	if err := s.store.Queries().DeleteCIClass(ctx, classID); err != nil {
		return fmt.Errorf("failed to delete CI class: %w", err)
	}
	return nil
}

// ListCategories lists all CI categories with their usage counts.
func (s *AdminManagementService) ListCategories(ctx context.Context, actor *domain.Actor) ([]CategoryDTO, error) {
	rows, err := s.store.Queries().ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list categories: %w", err)
	}
	res := make([]CategoryDTO, len(rows))
	for i, r := range rows {
		res[i] = CategoryDTO{
			ID:          r.ID,
			Name:        r.Name,
			Description: r.Description,
			Icon:        r.Icon,
			Color:       r.Color,
			ClassCount:  r.ClassCount,
			CICount:     r.CiCount,
			CreatedAt:   r.CreatedAt,
			UpdatedAt:   r.UpdatedAt,
		}
	}
	return res, nil
}

// CreateCategory creates a new custom CI category.
func (s *AdminManagementService) CreateCategory(ctx context.Context, actor *domain.Actor, req CreateCategoryRequestDTO) (*CategoryDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: category creation requires platform_admin", domain.ErrForbidden)
	}

	id := slugify(req.ID)
	if id == "" {
		id = slugify(req.Name)
	}
	if id == "" {
		return nil, fmt.Errorf("%w: category name cannot be empty", domain.ErrBadParam)
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("%w: category name cannot be empty", domain.ErrBadParam)
	}
	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "Layers"
	}
	color := strings.TrimSpace(req.Color)
	if color == "" {
		color = "cyan"
	}

	row, err := s.store.Queries().CreateCategory(ctx, sqlcgen.CreateCategoryParams{
		ID:          id,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		Icon:        icon,
		Color:       color,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, fmt.Errorf("%w: category id or name already exists", domain.ErrConflict)
		}
		return nil, fmt.Errorf("failed to create category: %w", err)
	}

	return &CategoryDTO{
		ID:          row.ID,
		Name:        row.Name,
		Description: row.Description,
		Icon:        row.Icon,
		Color:       row.Color,
		ClassCount:  0,
		CICount:     0,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}, nil
}

// UpdateCategory updates a custom CI category.
func (s *AdminManagementService) UpdateCategory(ctx context.Context, actor *domain.Actor, id string, req UpdateCategoryRequestDTO) (*CategoryDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: category update requires platform_admin", domain.ErrForbidden)
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("%w: category name cannot be empty", domain.ErrBadParam)
	}
	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "Layers"
	}
	color := strings.TrimSpace(req.Color)
	if color == "" {
		color = "cyan"
	}

	row, err := s.store.Queries().UpdateCategory(ctx, sqlcgen.UpdateCategoryParams{
		ID:          id,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		Icon:        icon,
		Color:       color,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: category not found", domain.ErrNotFound)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, fmt.Errorf("%w: category name already exists", domain.ErrConflict)
		}
		return nil, fmt.Errorf("failed to update category: %w", err)
	}

	counts, _ := s.store.Queries().CountClassesAndCIsByCategory(ctx, id)

	return &CategoryDTO{
		ID:          row.ID,
		Name:        row.Name,
		Description: row.Description,
		Icon:        row.Icon,
		Color:       row.Color,
		ClassCount:  counts.ClassCount,
		CICount:     counts.CiCount,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}, nil
}

// DeleteCategory deletes a category if no CIs or CI classes use it.
func (s *AdminManagementService) DeleteCategory(ctx context.Context, actor *domain.Actor, id string) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: category deletion requires platform_admin", domain.ErrForbidden)
	}

	counts, err := s.store.Queries().CountClassesAndCIsByCategory(ctx, id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("failed to verify category dependencies: %w", err)
	}
	if counts.CiCount > 0 {
		return fmt.Errorf("%w: cannot delete category %q: %d active CI(s) belong to classes in this category", domain.ErrConflict, id, counts.CiCount)
	}
	if counts.ClassCount > 0 {
		return fmt.Errorf("%w: cannot delete category %q: %d CI class(es) are assigned to this category", domain.ErrConflict, id, counts.ClassCount)
	}

	if err := s.store.Queries().DeleteCategory(ctx, id); err != nil {
		return fmt.Errorf("failed to delete category: %w", err)
	}
	return nil
}

// ListRelationshipTypes lists all relationship types with active edge usage counts.
func (s *AdminManagementService) ListRelationshipTypes(ctx context.Context, actor *domain.Actor) ([]RelationshipTypeDTO, error) {
	rows, err := s.store.Queries().ListRelationshipTypes(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list relationship types: %w", err)
	}
	res := make([]RelationshipTypeDTO, len(rows))
	for i, r := range rows {
		res[i] = RelationshipTypeDTO{
			ID:           r.ID,
			Label:        r.Label,
			ReverseLabel: r.ReverseLabel,
			Description:  r.Description,
			Color:        r.Color,
			EdgeCount:    r.EdgeCount,
			CreatedAt:    r.CreatedAt,
			UpdatedAt:    r.UpdatedAt,
		}
	}
	return res, nil
}

// CreateRelationshipType creates a new custom relationship type.
func (s *AdminManagementService) CreateRelationshipType(ctx context.Context, actor *domain.Actor, req CreateRelationshipTypeRequestDTO) (*RelationshipTypeDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: relationship type creation requires platform_admin", domain.ErrForbidden)
	}

	id := slugify(req.ID)
	if id == "" {
		id = slugify(req.Label)
	}
	if id == "" {
		return nil, fmt.Errorf("%w: relationship label cannot be empty", domain.ErrBadParam)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		return nil, fmt.Errorf("%w: relationship label cannot be empty", domain.ErrBadParam)
	}
	revLabel := strings.TrimSpace(req.ReverseLabel)
	color := strings.TrimSpace(req.Color)
	if color == "" {
		color = "cyan"
	}

	row, err := s.store.Queries().CreateRelationshipType(ctx, sqlcgen.CreateRelationshipTypeParams{
		ID:           id,
		Label:        label,
		ReverseLabel: revLabel,
		Description:  strings.TrimSpace(req.Description),
		Color:        color,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, fmt.Errorf("%w: relationship type ID already exists", domain.ErrConflict)
		}
		return nil, fmt.Errorf("failed to create relationship type: %w", err)
	}

	return &RelationshipTypeDTO{
		ID:           row.ID,
		Label:        row.Label,
		ReverseLabel: row.ReverseLabel,
		Description:  row.Description,
		Color:        row.Color,
		EdgeCount:    0,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}, nil
}

// UpdateRelationshipType updates an existing relationship type.
func (s *AdminManagementService) UpdateRelationshipType(ctx context.Context, actor *domain.Actor, id string, req UpdateRelationshipTypeRequestDTO) (*RelationshipTypeDTO, error) {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return nil, fmt.Errorf("%w: relationship type update requires platform_admin", domain.ErrForbidden)
	}

	label := strings.TrimSpace(req.Label)
	if label == "" {
		return nil, fmt.Errorf("%w: relationship label cannot be empty", domain.ErrBadParam)
	}
	revLabel := strings.TrimSpace(req.ReverseLabel)
	color := strings.TrimSpace(req.Color)
	if color == "" {
		color = "cyan"
	}

	row, err := s.store.Queries().UpdateRelationshipType(ctx, sqlcgen.UpdateRelationshipTypeParams{
		ID:           id,
		Label:        label,
		ReverseLabel: revLabel,
		Description:  strings.TrimSpace(req.Description),
		Color:        color,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: relationship type not found", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("failed to update relationship type: %w", err)
	}

	edgeCount, _ := s.store.Queries().CountEdgesByRelationshipType(ctx, id)

	return &RelationshipTypeDTO{
		ID:           row.ID,
		Label:        row.Label,
		ReverseLabel: row.ReverseLabel,
		Description:  row.Description,
		Color:        row.Color,
		EdgeCount:    edgeCount,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}, nil
}

// DeleteRelationshipType deletes a custom relationship type if no edges use it.
func (s *AdminManagementService) DeleteRelationshipType(ctx context.Context, actor *domain.Actor, id string) error {
	if !actor.HasRole(domain.RolePlatformAdmin) {
		return fmt.Errorf("%w: relationship type deletion requires platform_admin", domain.ErrForbidden)
	}

	edgeCount, err := s.store.Queries().CountEdgesByRelationshipType(ctx, id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("failed to check edge usage: %w", err)
	}
	if edgeCount > 0 {
		return fmt.Errorf("%w: cannot delete relationship %q: %d active CI topology edge(s) use this relationship", domain.ErrConflict, id, edgeCount)
	}

	if err := s.store.Queries().DeleteRelationshipType(ctx, id); err != nil {
		return fmt.Errorf("failed to delete relationship type: %w", err)
	}
	return nil
}
