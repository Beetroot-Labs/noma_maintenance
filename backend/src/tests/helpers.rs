use std::sync::Arc;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use chrono::Duration;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::state::{AppState, AuthConfig, ShiftEventHub, StorageConfig};
use crate::storage::{MemStorage, Storage};

pub fn test_state(pool: PgPool) -> AppState {
    AppState {
        client: reqwest::Client::new(),
        db_pool: Some(pool),
        storage: None,
        auth: Some(AuthConfig {
            google_client_ids: vec!["test-client-id".to_string()],
            google_hosted_domain: None,
            session_cookie_name: "noma_session".to_string(),
            session_duration: Duration::days(30),
            cookie_secure: false,
            dev_login_enabled: false,
        }),
        shift_events: ShiftEventHub::default(),
    }
}

pub fn build_router(pool: PgPool) -> Router {
    Router::new().nest("/api", crate::build_api_router(test_state(pool)))
}

pub fn build_router_with_dev_login(pool: PgPool) -> Router {
    let mut state = test_state(pool);
    if let Some(auth) = state.auth.as_mut() {
        auth.dev_login_enabled = true;
    }
    Router::new().nest("/api", crate::build_api_router(state))
}

// Router with `state.storage = Some(...)` and a MemStorage client. Use when the test
// doesn't need to inspect what was stored (validation errors, auth/state 403s, etc.).
pub fn build_router_with_fake_storage(pool: PgPool) -> Router {
    let (router, _) = build_router_with_mem_storage(pool);
    router
}

// Same as `build_router_with_fake_storage` but returns the MemStorage handle so the
// test can assert on put/fetch/delete (e.g., F4.1, G5.1, F4.8 replay-no-double-upload).
pub fn build_router_with_mem_storage(pool: PgPool) -> (Router, Arc<MemStorage>) {
    let mem = Arc::new(MemStorage::new());
    let client: Arc<dyn Storage> = mem.clone();
    let mut state = test_state(pool);
    state.storage = Some(StorageConfig {
        device_photo_prefix: "device-photos".to_string(),
        shift_signature_prefix: "shift-signatures".to_string(),
        client,
    });
    (Router::new().nest("/api", crate::build_api_router(state)), mem)
}

pub async fn call(router: &Router, req: Request<Body>) -> (StatusCode, Bytes) {
    let response = router.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, body)
}

pub fn make_req(
    method: &str,
    path: &str,
    token: &str,
    mutation_id: Option<&str>,
    json_body: Option<serde_json::Value>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("/api{path}"))
        .header("Cookie", format!("noma_session={token}"));
    if let Some(mid) = mutation_id {
        builder = builder.header("X-Mutation-Id", mid);
    }
    if let Some(body) = json_body {
        builder = builder.header("Content-Type", "application/json");
        builder.body(Body::from(body.to_string())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    }
}

pub fn make_req_raw_mid(
    method: &str,
    path: &str,
    token: &str,
    raw_mid: &str,
    json_body: Option<serde_json::Value>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("/api{path}"))
        .header("Cookie", format!("noma_session={token}"))
        .header("X-Mutation-Id", raw_mid);
    if let Some(body) = json_body {
        builder = builder.header("Content-Type", "application/json");
        builder.body(Body::from(body.to_string())).unwrap()
    } else {
        builder.body(Body::empty()).unwrap()
    }
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

// --- Seed types ---

pub struct SeededTenant {
    pub id: Uuid,
}

pub struct SeededUser {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub session_token: String,
}

pub struct SeededBuilding {
    pub id: Uuid,
    pub tenant_id: Uuid,
}

pub struct SeededShift {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub lead_id: Uuid,
}

pub struct SeededDevice {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub location_id: Uuid,
}

pub struct SeededLocation {
    pub id: Uuid,
}

// --- Seed functions ---

pub async fn seed_tenant(pool: &PgPool) -> SeededTenant {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO tenants (id, name) VALUES ($1, $2)")
        .bind(id)
        .bind(format!("tenant-{id}"))
        .execute(pool)
        .await
        .unwrap();
    SeededTenant { id }
}

pub async fn seed_user(pool: &PgPool, tenant_id: Uuid, role: &str) -> SeededUser {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, tenant_id, full_name, email, role) \
         VALUES ($1, $2, $3, $4, $5::user_role)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(format!("User {}", &id.to_string()[..8]))
    .bind(format!("{}@test.local", id))
    .bind(role)
    .execute(pool)
    .await
    .unwrap();

    let token = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO sessions (user_id, session_token_hash, expires_at) \
         VALUES ($1, $2, NOW() + INTERVAL '30 days')",
    )
    .bind(id)
    .bind(sha256_hex(&token))
    .execute(pool)
    .await
    .unwrap();

    SeededUser { id, tenant_id, session_token: token }
}

pub async fn seed_building(pool: &PgPool, tenant_id: Uuid) -> SeededBuilding {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO buildings (id, tenant_id, name, address) VALUES ($1, $2, $3, '1 Test St')",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(format!("Building {}", &id.to_string()[..8]))
    .execute(pool)
    .await
    .unwrap();
    SeededBuilding { id, tenant_id }
}

pub async fn seed_shift(
    pool: &PgPool,
    tenant_id: Uuid,
    building_id: Uuid,
    lead_id: Uuid,
) -> SeededShift {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, building_id, lead_user_id, status, started_at) \
         VALUES ($1, $2, $3, $4, 'IN_PROGRESS', NOW())",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(building_id)
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO shift_participants (tenant_id, shift_id, user_id, status, cache_ready_at) \
         VALUES ($1, $2, $3, 'CACHE_READY', NOW())",
    )
    .bind(tenant_id)
    .bind(id)
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();

    SeededShift { id, tenant_id, lead_id }
}

// Seed a shift in an arbitrary status, with the lead inserted as a participant whose status
// matches the shift state semantics (INVITED for INVITING, CACHE_READY otherwise, or
// CLOSE_CONFIRMED for READY_TO_COMMIT/COMMITTED). For frozen target states we insert the
// participant *before* flipping the status, since DB triggers reject participant inserts on
// frozen shifts.
pub async fn seed_shift_in_state(
    pool: &PgPool,
    tenant_id: Uuid,
    building_id: Uuid,
    lead_id: Uuid,
    shift_status: &str,
) -> SeededShift {
    let id = Uuid::new_v4();

    let lead_participant_status = match shift_status {
        "INVITING" | "READY_TO_START" => "INVITED",
        "READY_TO_COMMIT" | "COMMITTED" => "CLOSE_CONFIRMED",
        _ => "CACHE_READY",
    };

    // Step 1 — insert the shift as IN_PROGRESS (a non-frozen, non-INVITING state) so we can
    // freely attach the lead participant without tripping participant triggers.
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, building_id, lead_user_id, status, started_at) \
         VALUES ($1, $2, $3, $4, 'IN_PROGRESS', NOW())",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(building_id)
    .bind(lead_id)
    .execute(pool)
    .await
    .unwrap();

    add_participant(pool, tenant_id, id, lead_id, lead_participant_status).await;

    // Step 2 — flip the shift to the target status, also bumping the right timestamps so the
    // row is consistent with how the handlers would have left it.
    let close_requested_sql = if matches!(shift_status, "CLOSE_REQUESTED" | "READY_TO_COMMIT" | "COMMITTED") {
        "NOW()"
    } else {
        "NULL"
    };
    let committed_sql = if shift_status == "COMMITTED" {
        "NOW()"
    } else {
        "NULL"
    };
    let started_at_sql = if matches!(shift_status, "INVITING" | "READY_TO_START") {
        "NULL"
    } else {
        "started_at"
    };

    let sql = format!(
        "UPDATE shifts \
         SET status = $1::shift_status, \
             started_at = {started_at_sql}, \
             close_requested_at = {close_requested_sql}, \
             committed_at = {committed_sql} \
         WHERE id = $2"
    );
    sqlx::query(&sql)
        .bind(shift_status)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();

    SeededShift { id, tenant_id, lead_id }
}

pub async fn add_participant(
    pool: &PgPool,
    tenant_id: Uuid,
    shift_id: Uuid,
    user_id: Uuid,
    status: &str,
) {
    let invited_at_sql = if matches!(status, "INVITED" | "DECLINED" | "CACHE_READY" | "CLOSE_CONFIRMED") {
        "NOW()"
    } else {
        "NULL"
    };
    let cache_ready_at_sql = if matches!(status, "CACHE_READY" | "CLOSE_CONFIRMED") {
        "NOW()"
    } else {
        "NULL"
    };
    let close_confirmed_at_sql = if status == "CLOSE_CONFIRMED" {
        "NOW()"
    } else {
        "NULL"
    };

    let sql = format!(
        "INSERT INTO shift_participants \
         (tenant_id, shift_id, user_id, status, invited_at, cache_ready_at, close_confirmed_at) \
         VALUES ($1, $2, $3, $4::shift_participant_status, {invited_at_sql}, {cache_ready_at_sql}, {close_confirmed_at_sql})"
    );
    sqlx::query(&sql)
        .bind(tenant_id)
        .bind(shift_id)
        .bind(user_id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
}

pub async fn shift_status(pool: &PgPool, shift_id: Uuid) -> Option<String> {
    sqlx::query_scalar("SELECT status::text FROM shifts WHERE id = $1")
        .bind(shift_id)
        .fetch_optional(pool)
        .await
        .unwrap()
}

pub async fn participant_status(
    pool: &PgPool,
    shift_id: Uuid,
    user_id: Uuid,
) -> Option<String> {
    sqlx::query_scalar(
        "SELECT status::text FROM shift_participants WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

pub async fn seed_device(pool: &PgPool, tenant_id: Uuid, building_id: Uuid) -> SeededDevice {
    let location = seed_location(pool, tenant_id, building_id).await;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO devices (id, tenant_id, location_id, kind) \
         VALUES ($1, $2, $3, 'FAN_COIL'::device_kind)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(location.id)
    .execute(pool)
    .await
    .unwrap();

    SeededDevice {
        id,
        tenant_id,
        location_id: location.id,
    }
}

pub async fn seed_location(
    pool: &PgPool,
    tenant_id: Uuid,
    building_id: Uuid,
) -> SeededLocation {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO site_locations (id, tenant_id, building_id, floor) \
         VALUES ($1, $2, $3, '1')",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(building_id)
    .execute(pool)
    .await
    .unwrap();
    SeededLocation { id }
}

// Active barcode (deactivated_at IS NULL).
pub async fn seed_barcode_active(
    pool: &PgPool,
    tenant_id: Uuid,
    device_id: Uuid,
    code: &str,
) {
    sqlx::query(
        "INSERT INTO barcodes (tenant_id, code, device_id, deactivated_at) \
         VALUES ($1, $2, $3, NULL)",
    )
    .bind(tenant_id)
    .bind(code)
    .bind(device_id)
    .execute(pool)
    .await
    .unwrap();
}

// Deactivated barcode — useful for asserting reactivation flows.
pub async fn seed_barcode_deactivated(
    pool: &PgPool,
    tenant_id: Uuid,
    device_id: Uuid,
    code: &str,
) {
    sqlx::query(
        "INSERT INTO barcodes (tenant_id, code, device_id, deactivated_at) \
         VALUES ($1, $2, $3, NOW())",
    )
    .bind(tenant_id)
    .bind(code)
    .bind(device_id)
    .execute(pool)
    .await
    .unwrap();
}

pub async fn seed_maintenance_work(
    pool: &PgPool,
    tenant_id: Uuid,
    shift_id: Uuid,
    device_id: Uuid,
    maintainer_user_id: Uuid,
) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO maintenance_works \
         (id, tenant_id, shift_id, device_id, maintainer_user_id, status, finished_at) \
         VALUES ($1, $2, $3, $4, $5, 'FINISHED', NOW())",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(shift_id)
    .bind(device_id)
    .bind(maintainer_user_id)
    .execute(pool)
    .await
    .unwrap();
    id
}
