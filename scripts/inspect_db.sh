#!/usr/bin/env bash
# ==============================================================================
# ETCMS Database Inspector & Viewer
# Inspects and displays enterprise CMDB data stored in the Docker database:
#   - Relational record counts & health scorecard
#   - CI distribution by class, tier, environment, and lifecycle
#   - Dependency topology & handshake status summary
#   - High in-degree Single Points of Failure (SPOFs)
#   - Audit log stream
# ==============================================================================

set -euo pipefail

# ANSI color codes
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
MAGENTA="\033[0;35m"
RED="\033[0;31m"
GRAY="\033[0;90m"
NC="\033[0m"

CONTAINER_NAME="${DOCKER_CONTAINER:-etcms-prod-db}"
DB_USER="${POSTGRES_USER:-etcms}"
DB_NAME="${POSTGRES_DB:-etcms}"

run_sql() {
    local sql="$1"
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -c "${sql}"
    elif [[ -n "${DATABASE_URL:-}" ]]; then
        psql "${DATABASE_URL}" -c "${sql}"
    else
        psql -U "${DB_USER}" -d "${DB_NAME}" -h localhost -c "${sql}"
    fi
}

run_sql_cmd() {
    local sql="$1"
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" ${2:-} -c "${sql}"
    elif [[ -n "${DATABASE_URL:-}" ]]; then
        psql "${DATABASE_URL}" ${2:-} -c "${sql}"
    else
        psql -U "${DB_USER}" -d "${DB_NAME}" -h localhost ${2:-} -c "${sql}"
    fi
}

MODE="${1:-summary}"

case "${MODE}" in
    -h|--help|help)
        echo -e "${BOLD}Usage:${NC} $0 [summary | cis | edges | audit | health | all]"
        echo ""
        echo "Options:"
        echo "  summary    (Default) View executive CMDB inventory, tiers, topology & health."
        echo "  cis        View list of all Configuration Items with classes and owner groups."
        echo "  edges      View all dependency relationships and handshake statuses."
        echo "  audit      View recent immutable audit trail log events."
        echo "  health     View ITIL v3 CMDB '3 Cs' health metrics (Freshness, Orphans, Handshakes)."
        echo "  all        Run full inspection displaying all sections."
        exit 0
        ;;
esac

echo -e "${BOLD}${CYAN}========================================================================================${NC}"
echo -e "${BOLD}${CYAN}                     ETCMS ENTERPRISE CMDB DATABASE VIEWER                              ${NC}"
echo -e "${BOLD}${CYAN}========================================================================================${NC}"

# Check connection
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$" && [[ -z "${DATABASE_URL:-}" ]] && ! command -v psql >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Target database container '${CONTAINER_NAME}' is not running.${NC}"
    exit 1
fi

if [[ "${MODE}" == "summary" || "${MODE}" == "all" ]]; then
    echo -e "\n${BOLD}${BLUE}▶ 1. DATABASE RECORD COUNTS${NC}"
    run_sql "
    SELECT 
        (SELECT count(*) FROM owner_groups) AS owner_groups,
        (SELECT count(*) FROM users) AS users,
        (SELECT count(*) FROM ci_classes) AS ci_classes,
        (SELECT count(*) FROM cis) AS configuration_items,
        (SELECT count(*) FROM ci_edges) AS dependency_edges,
        (SELECT count(*) FROM ci_flags WHERE status = 'open') AS open_flags,
        (SELECT count(*) FROM audit_logs) AS audit_records,
        (SELECT count(*) FROM baselines) AS baselines,
        (SELECT count(*) FROM intake_campaigns) AS intake_campaigns;
    "

    echo -e "\n${BOLD}${BLUE}▶ 2. CONFIGURATION ITEMS BY CRITICALITY TIER & ENVIRONMENT${NC}"
    run_sql "
    SELECT 
        criticality_tier,
        count(*) FILTER (WHERE environment = 'prod') AS prod,
        count(*) FILTER (WHERE environment = 'dr') AS dr,
        count(*) FILTER (WHERE environment = 'staging') AS staging,
        count(*) AS total_cis
    FROM cis
    GROUP BY criticality_tier
    ORDER BY criticality_tier;
    "

    echo -e "\n${BOLD}${BLUE}▶ 3. CONFIGURATION ITEMS BY CI CLASS & LIFECYCLE STATE${NC}"
    run_sql "
    SELECT 
        ci_class,
        count(*) FILTER (WHERE lifecycle_state = 'in_service') AS in_service,
        count(*) FILTER (WHERE lifecycle_state = 'planned') AS planned,
        count(*) FILTER (WHERE lifecycle_state = 'deprecated') AS deprecated,
        count(*) FILTER (WHERE lifecycle_state = 'retired') AS retired,
        count(*) AS total
    FROM cis
    GROUP BY ci_class
    ORDER BY total DESC;
    "

    echo -e "\n${BOLD}${BLUE}▶ 4. OWNER GROUP ALLOCATIONS${NC}"
    run_sql "
    SELECT 
        og.name AS owner_group,
        og.team_lead_name AS lead,
        count(c.ci_id) AS managed_cis,
        count(c.ci_id) FILTER (WHERE c.criticality_tier = 'tier_0') AS tier_0_cis
    FROM owner_groups og
    LEFT JOIN cis c ON c.owner_group_id = og.id
    GROUP BY og.id, og.name, og.team_lead_name
    ORDER BY managed_cis DESC;
    "

    echo -e "\n${BOLD}${BLUE}▶ 5. DEPENDENCY TOPOLOGY & HANDSHAKE SUMMARY${NC}"
    run_sql "
    SELECT 
        edge_type,
        count(*) FILTER (WHERE handshake_status = 'confirmed') AS confirmed,
        count(*) FILTER (WHERE handshake_status = 'pending_confirmation') AS pending_inbox,
        count(*) FILTER (WHERE handshake_status = 'flagged_mismatch') AS flagged_mismatch,
        count(*) FILTER (WHERE handshake_status = 'rejected') AS rejected,
        count(*) AS total_edges
    FROM ci_edges
    GROUP BY edge_type
    ORDER BY total_edges DESC;
    "

    echo -e "\n${BOLD}${BLUE}▶ 6. TOP 5 SINGLE POINTS OF FAILURE (Highest Upstream Dependents / In-Degree)${NC}"
    run_sql "
    SELECT 
        c.name AS ci_name,
        c.ci_class,
        c.criticality_tier AS tier,
        c.environment AS env,
        count(e.id) AS dependent_consumers
    FROM cis c
    JOIN ci_edges e ON e.target_ci_id = c.ci_id
    WHERE e.handshake_status = 'confirmed'
    GROUP BY c.ci_id, c.name, c.ci_class, c.criticality_tier, c.environment
    ORDER BY dependent_consumers DESC
    LIMIT 5;
    "
fi

if [[ "${MODE}" == "health" || "${MODE}" == "summary" || "${MODE}" == "all" ]]; then
    echo -e "\n${BOLD}${GREEN}▶ 7. ITIL v3 CMDB HEALTH SCORECARD (3 Cs)${NC}"
    run_sql "
    WITH freshness AS (
        SELECT 
            count(*)::float AS total_in_service,
            count(*) FILTER (WHERE last_verified_at >= now() - interval '60 days')::float AS fresh_count
        FROM cis WHERE lifecycle_state = 'in_service'
    ),
    orphans AS (
        SELECT count(*) AS orphan_count
        FROM cis c
        WHERE c.lifecycle_state = 'in_service'
          AND c.ci_class IN ('database', 'vm_cluster', 'physical_host', 'network_firewall')
          AND NOT EXISTS (
              SELECT 1 FROM ci_edges e
              JOIN cis src ON src.ci_id = e.source_ci_id
              WHERE e.target_ci_id = c.ci_id
                AND e.handshake_status = 'confirmed'
          )
    ),
    pending AS (
        SELECT count(*) AS pending_count FROM ci_edges WHERE handshake_status = 'pending_confirmation'
    ),
    flags AS (
        SELECT count(*) AS open_flags_count FROM ci_flags WHERE status = 'open'
    )
    SELECT 
        ROUND((f.fresh_count / NULLIF(f.total_in_service, 0) * 100)::numeric, 1) || '%' AS freshness_rate,
        f.fresh_count::int || '/' || f.total_in_service::int AS fresh_cis,
        o.orphan_count AS orphan_technical_cis,
        p.pending_count AS pending_handshakes,
        fl.open_flags_count AS active_flags
    FROM freshness f, orphans o, pending p, flags fl;
    "
fi

if [[ "${MODE}" == "audit" || "${MODE}" == "all" ]]; then
    echo -e "\n${BOLD}${MAGENTA}▶ 8. IMMUTABLE AUDIT TRAIL LOGS (Latest 8 Events)${NC}"
    run_sql "
    SELECT 
        al.created_at::timestamptz(0) AS timestamp,
        al.action,
        al.entity_type,
        u.name AS actor,
        al.diff
    FROM audit_logs al
    JOIN users u ON u.id = al.actor_id
    ORDER BY al.created_at DESC
    LIMIT 8;
    "
fi

if [[ "${MODE}" == "cis" || "${MODE}" == "all" ]]; then
    echo -e "\n${BOLD}${CYAN}▶ 9. CONFIGURATION ITEMS INVENTORY SAMPLE${NC}"
    run_sql "
    SELECT 
        c.name,
        c.ci_class,
        c.environment AS env,
        c.criticality_tier AS tier,
        c.lifecycle_state AS state,
        og.name AS owner_group,
        c.last_verified_at::date AS verified_date
    FROM cis c
    JOIN owner_groups og ON og.id = c.owner_group_id
    ORDER BY c.criticality_tier, c.name
    LIMIT 35;
    "
fi

if [[ "${MODE}" == "edges" ]]; then
    echo -e "\n${BOLD}${CYAN}▶ DEPENDENCY EDGES DETAIL${NC}"
    run_sql "
    SELECT 
        src.name AS consumer_source,
        e.edge_type AS relationship,
        tgt.name AS provider_target,
        e.handshake_status,
        e.confirmed_at::date AS confirmed
    FROM ci_edges e
    JOIN cis src ON src.ci_id = e.source_ci_id
    JOIN cis tgt ON tgt.ci_id = e.target_ci_id
    ORDER BY e.edge_type, src.name;
    "
fi

echo -e "\n${BOLD}${CYAN}========================================================================================${NC}"
echo -e "${GREEN}✔ Inspection complete.${NC} For specific views: ${GRAY}./scripts/inspect_db.sh [cis|edges|audit|health|all]${NC}"
echo -e "${BOLD}${CYAN}========================================================================================${NC}"
