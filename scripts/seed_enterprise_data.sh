#!/usr/bin/env bash
# ==============================================================================
# ETCMS Enterprise Database Seeder
# Seeds the PostgreSQL database (Docker container or local instance) with a
# rich, interconnected enterprise CMDB dataset:
#   - 7 Owner Groups & 9 Users
#   - 50 Configuration Items across 7 classes, 4 tiers, and 3 environments
#   - 72 Dependency edges (confirmed, pending, flagged, rejected handshakes)
#   - Audits, baselines, intake campaigns, and digest cycles
# ==============================================================================

set -euo pipefail

# ANSI color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m" # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SEEDS_SQL="${PROJECT_ROOT}/etcms-backend/sql/seeds.sql"

CONTAINER_NAME="${DOCKER_CONTAINER:-etcms-prod-db}"
DB_USER="${POSTGRES_USER:-etcms}"
DB_NAME="${POSTGRES_DB:-etcms}"

echo -e "${BOLD}${CYAN}======================================================================${NC}"
echo -e "${BOLD}${CYAN}           ETCMS Enterprise CMDB Database Seeding Tool                ${NC}"
echo -e "${BOLD}${CYAN}======================================================================${NC}"

if [[ ! -f "${SEEDS_SQL}" ]]; then
    echo -e "${RED}[ERROR] Seed SQL script not found at ${SEEDS_SQL}${NC}"
    exit 1
fi

apply_seeds() {
    # Method 1: Docker container execution
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo -e "${CYAN}[*] Target: Docker container '${CONTAINER_NAME}' (database: ${DB_NAME}, user: ${DB_USER})${NC}"
        echo -e "${CYAN}[*] Applying seed script ${SEEDS_SQL}...${NC}"
        docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" < "${SEEDS_SQL}"
        return 0
    fi

    # Method 2: DATABASE_URL environment variable
    if [[ -n "${DATABASE_URL:-}" ]]; then
        echo -e "${CYAN}[*] Target: DATABASE_URL connection string${NC}"
        echo -e "${CYAN}[*] Applying seed script ${SEEDS_SQL}...${NC}"
        psql "${DATABASE_URL}" < "${SEEDS_SQL}"
        return 0
    fi

    # Method 3: Local psql fallback
    if command -v psql >/dev/null 2>&1; then
        echo -e "${YELLOW}[!] Docker container '${CONTAINER_NAME}' not running; attempting local psql...${NC}"
        psql -U "${DB_USER}" -d "${DB_NAME}" -h localhost < "${SEEDS_SQL}"
        return 0
    fi

    echo -e "${RED}[ERROR] Cannot connect to database. Neither Docker container '${CONTAINER_NAME}' nor local psql is accessible.${NC}"
    exit 1
}

apply_seeds

echo ""
echo -e "${BOLD}${GREEN}✔ Successfully seeded enterprise CMDB data!${NC}"
echo ""

# Run verification and print inventory summary
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${BOLD}Current Database Inventory Summary:${NC}"
    docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -A -c "
        SELECT '  • Owner Groups:       ' || count(*) FROM owner_groups
        UNION ALL
        SELECT '  • Enterprise Users:   ' || count(*) FROM users
        UNION ALL
        SELECT '  • Configuration Items:' || count(*) FROM cis
        UNION ALL
        SELECT '  • Dependency Edges:   ' || count(*) FROM ci_edges
        UNION ALL
        SELECT '  • Active CI Flags:    ' || count(*) FROM ci_flags WHERE status = 'open'
        UNION ALL
        SELECT '  • Audit Log Events:   ' || count(*) FROM audit_logs
        UNION ALL
        SELECT '  • Intake Campaigns:   ' || count(*) FROM intake_campaigns;
    "
fi

echo ""
echo -e "${CYAN}Tip: Run ${BOLD}./scripts/inspect_db.sh${NC}${CYAN} to view detailed topology and health metrics.${NC}"
echo -e "${CYAN}Tip: Access Web UI at ${BOLD}http://localhost:8080${NC}${CYAN} (Login: admin@enterprise.com / Admin123!)${NC}"
