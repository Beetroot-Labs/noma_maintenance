use axum::Router;
use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use chrono::Duration;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::state::{AppState, AuthConfig, ShiftEventHub};

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
        }),
        shift_events: ShiftEventHub::default(),
    }
}

pub fn build_router(pool: PgPool) -> Router {
    Router::new().nest("/api", crate::build_api_router(test_state(pool)))
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

pub async fn seed_device(pool: &PgPool, tenant_id: Uuid, building_id: Uuid) -> SeededDevice {
    let location_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO site_locations (id, tenant_id, building_id, floor) \
         VALUES ($1, $2, $3, '1')",
    )
    .bind(location_id)
    .bind(tenant_id)
    .bind(building_id)
    .execute(pool)
    .await
    .unwrap();

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO devices (id, tenant_id, location_id, kind) \
         VALUES ($1, $2, $3, 'FAN_COIL'::device_kind)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(location_id)
    .execute(pool)
    .await
    .unwrap();

    SeededDevice { id, tenant_id }
}
