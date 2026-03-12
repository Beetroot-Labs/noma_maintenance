mod auth;
mod error;
mod labeling;
mod maintenance;
mod shifts;
mod state;
mod storage;
mod sync;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, header};
use axum::routing::{get, patch, post, put};
use chrono::Duration;
use simple_logger::SimpleLogger;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::auth::{get_current_user, google_login, logout};
use crate::labeling::{
    assign_labeling_device_barcode, delete_labeling_device_photo, get_labeling_building_cache,
    get_labeling_device_photo, list_labeling_buildings, update_labeling_device_details,
    upload_labeling_device_photo,
};
use crate::maintenance::{sync_maintenance_work, upload_maintenance_photo};
use crate::shifts::{
    accept_shift_invitation, add_shift_participant, cancel_shift, commit_shift,
    confirm_shift_close,
    create_shift, get_current_shift_state, get_shift_maintenance_summary, get_shift_waiting_room,
    list_shift_invite_candidates, mark_shift_cache_ready, remove_shift_participant,
    request_shift_close, start_shift, upload_shift_signature,
};
use crate::state::{AppState, AuthConfig, load_google_client_ids, load_storage_config};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let log_level = std::env::var("RUST_LOG").unwrap_or_else(|_| "debug".to_string());
    SimpleLogger::new()
        .with_level(log::LevelFilter::from_str(&log_level).unwrap_or(log::LevelFilter::Debug))
        .init()
        .expect("failed to initialize logger");
    log::info!("Starting server...");

    let env_file_path = std::env::var("ENV_FILE").unwrap_or_else(|_| ".env".to_string());
    log::info!("Loading environment variables from {env_file_path}");
    dotenvy::from_filename(env_file_path).ok();
    log::info!("Environment variables loaded");

    let static_dir =
        std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/apps/main/dist".to_string());
    let labeling_static_dir = std::env::var("LABELING_STATIC_DIR")
        .unwrap_or_else(|_| "../frontend/apps/labeling/dist".to_string());
    let static_root = PathBuf::from(&static_dir);
    let labeling_static_root = PathBuf::from(&labeling_static_dir);
    let assets_root = static_root.join("assets");
    let index_file = static_root.join("index.html");
    let labeling_assets_root = labeling_static_root.join("assets");
    let labeling_index_file = labeling_static_root.join("index.html");
    let labeling_manifest_file = labeling_static_root.join("manifest.json");
    let labeling_sw_file = labeling_static_root.join("sw.js");
    let labeling_favicon_file = labeling_static_root.join("favicon.ico");
    log::info!("Serving main frontend from {}", static_root.display());
    log::info!(
        "Serving labeling frontend from {} at /labeling-app",
        labeling_static_root.display()
    );

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let database_url = std::env::var("DATABASE_URL").unwrap_or_default();
    let db_pool = if database_url.is_empty() {
        log::warn!("DATABASE_URL is missing; API endpoints requiring db will be unavailable");
        None
    } else {
        match PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
        {
            Ok(pool) => Some(pool),
            Err(err) => {
                log::error!("Failed to connect to database: {err}");
                None
            }
        }
    };

    let google_client_ids = load_google_client_ids();
    let google_hosted_domain = std::env::var("GOOGLE_HOSTED_DOMAIN").ok();
    let session_cookie_name =
        std::env::var("SESSION_COOKIE_NAME").unwrap_or_else(|_| "noma_session".to_string());
    let session_days = std::env::var("SESSION_DURATION_DAYS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(30);
    let cookie_secure = std::env::var("COOKIE_SECURE")
        .ok()
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let app_state = AppState {
        client: reqwest::Client::new(),
        db_pool,
        storage: load_storage_config()?,
        auth: (!google_client_ids.is_empty()).then_some(AuthConfig {
            google_client_ids,
            google_hosted_domain,
            session_cookie_name,
            session_duration: Duration::days(session_days),
            cookie_secure,
        }),
    };

    let api = Router::new()
        .route("/health-check", get(|| async { "OK" }))
        .route("/auth/google", post(google_login))
        .route("/auth/me", get(get_current_user))
        .route("/auth/logout", post(logout))
        .route("/users/invite-candidates", get(list_shift_invite_candidates))
        .route("/shifts", post(create_shift))
        .route("/shifts/current", get(get_current_shift_state))
        .route("/shifts/{shift_id}/participants", post(add_shift_participant))
        .route(
            "/shifts/{shift_id}/participants/{participant_user_id}",
            axum::routing::delete(remove_shift_participant),
        )
        .route("/shifts/{shift_id}/accept", post(accept_shift_invitation))
        .route("/shifts/{shift_id}/cache-ready", post(mark_shift_cache_ready))
        .route("/shifts/{shift_id}/start", post(start_shift))
        .route("/shifts/{shift_id}/close-request", post(request_shift_close))
        .route("/shifts/{shift_id}/close-confirm", post(confirm_shift_close))
        .route("/shifts/{shift_id}/commit", post(commit_shift))
        .route("/shifts/{shift_id}/signature-image", put(upload_shift_signature))
        .route("/shifts/{shift_id}/cancel", post(cancel_shift))
        .route("/shifts/{shift_id}/waiting-room", get(get_shift_waiting_room))
        .route(
            "/shifts/{shift_id}/maintenance-summary",
            get(get_shift_maintenance_summary),
        )
        .route("/labeling/buildings", get(list_labeling_buildings))
        .route(
            "/labeling/devices/{device_id}/barcode",
            post(assign_labeling_device_barcode),
        )
        .route(
            "/labeling/devices/{device_id}/photo",
            put(upload_labeling_device_photo)
                .get(get_labeling_device_photo)
                .delete(delete_labeling_device_photo),
        )
        .route(
            "/labeling/devices/{device_id}/details",
            patch(update_labeling_device_details),
        )
        .route(
            "/labeling/buildings/{building_id}/cache",
            get(get_labeling_building_cache),
        )
        .route("/maintenance/works/{work_id}/sync", post(sync_maintenance_work))
        .route(
            "/maintenance/works/{work_id}/photos/{photo_id}",
            put(upload_maintenance_photo),
        )
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024))
        .with_state(app_state);

    let assets_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ))
        .service(ServeDir::new(assets_root).append_index_html_on_directories(false));

    let index_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(ServeFile::new(index_file));

    let static_root_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(
            ServeDir::new(static_root)
                .append_index_html_on_directories(false)
                .fallback(index_service),
        );

    let labeling_assets_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ))
        .service(ServeDir::new(labeling_assets_root).append_index_html_on_directories(false));

    let labeling_index_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(ServeFile::new(labeling_index_file.clone()));

    let labeling_manifest_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(ServeFile::new(labeling_manifest_file));

    let labeling_sw_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(ServeFile::new(labeling_sw_file));

    let labeling_favicon_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ))
        .service(ServeFile::new(labeling_favicon_file));

    let labeling_root_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(
            ServeDir::new(labeling_static_root)
                .append_index_html_on_directories(false)
                .fallback(labeling_index_service),
        );

    let app = Router::new()
        .nest("/api", api)
        .nest_service("/labeling-app/manifest.json", labeling_manifest_service)
        .nest_service("/labeling-app/sw.js", labeling_sw_service)
        .nest_service("/labeling-app/favicon.ico", labeling_favicon_service)
        .nest_service("/labeling-app/assets", labeling_assets_service)
        .nest_service("/labeling-app", labeling_root_service)
        .nest_service("/assets", assets_service)
        .fallback_service(static_root_service)
        .layer(cors);

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = SocketAddr::from_str(&format!("{host}:{port}"))
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 3000)));
    log::info!("Listening on {addr}");
    let listener = TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
