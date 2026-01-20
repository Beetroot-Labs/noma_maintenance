use axum::Router;
use axum::http::{HeaderValue, header};
use axum::routing::get;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use std::net::SocketAddr;
use std::str::FromStr;
use std::path::PathBuf;
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use simple_logger::SimpleLogger;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let log_level = std::env::var("RUST_LOG").unwrap_or_else(|_| "debug".to_string());
    SimpleLogger::new()
        .with_level(log::LevelFilter::from_str(&log_level).unwrap_or(log::LevelFilter::Debug))
        .init()
        .expect("failed to initialize logger");
    log::info!("Starting server...");

    let env_file_path = std::env::var("ENV_FILE").unwrap_or_else(|_| ".env".to_string());
    log::info!("Loading environment variables from {}", env_file_path);
    dotenvy::from_filename(env_file_path).ok();
    log::info!("Environment variables loaded");

    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/dist".to_string());
    let static_root = PathBuf::from(&static_dir);
    let assets_root = static_root.join("assets");
    let index_file = static_root.join("index.html");
    log::info!("Serving frontend from {}", static_root.display());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let database_url = std::env::var("DATABASE_URL").unwrap_or_default();
    let db_pool = if database_url.is_empty() {
        log::warn!("DATABASE_URL is missing; hvac endpoint will be unavailable");
        None
    } else {
        match PgPoolOptions::new().max_connections(5).connect(&database_url).await {
            Ok(pool) => Some(pool),
            Err(err) => {
                log::error!("Failed to connect to database: {}", err);
                None
            }
        }
    };

    let app_state = AppState {
        client: reqwest::Client::new(),
        db_pool,
    };

    let api = Router::new()
        .route("/health-check", get(|| async { "OK" }))
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

    let app = Router::new()
        .nest("/api", api)
        .nest_service("/assets", assets_service)
        .fallback_service(static_root_service)
        .layer(cors);


    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = SocketAddr::from(([0, 0, 0, 0], port.parse::<u16>().unwrap_or(3000)));
    log::info!("Listening on {}", addr);
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    db_pool: Option<PgPool>,
}
