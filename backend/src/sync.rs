use axum::Json;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use sqlx::PgPool;

use crate::error::ApiError;

#[derive(sqlx::FromRow, Deserialize)]
struct ProcessedMutationResponse {
    response_status: i32,
    response_body: Option<serde_json::Value>,
}

pub fn require_mutation_id(headers: &HeaderMap) -> Result<String, ApiError> {
    let value = headers
        .get("x-mutation-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("missing X-Mutation-Id header"))?;

    if value.len() > 128 {
        return Err(ApiError::bad_request("X-Mutation-Id is too long"));
    }

    Ok(value.to_string())
}

pub async fn get_processed_mutation_response(
    pool: &PgPool,
    tenant_id: uuid::Uuid,
    endpoint_key: &str,
    mutation_id: &str,
) -> Result<Option<Response>, ApiError> {
    let processed = sqlx::query_as::<_, ProcessedMutationResponse>(
        r#"
        SELECT response_status, response_body
        FROM processed_mutations
        WHERE tenant_id = $1
          AND endpoint_key = $2
          AND mutation_id = $3
        "#,
    )
    .bind(tenant_id)
    .bind(endpoint_key)
    .bind(mutation_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(processed.map(replay_processed_mutation_response))
}

pub async fn get_processed_mutation_response_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: uuid::Uuid,
    endpoint_key: &str,
    mutation_id: &str,
) -> Result<Option<Response>, ApiError> {
    let processed = sqlx::query_as::<_, ProcessedMutationResponse>(
        r#"
        SELECT response_status, response_body
        FROM processed_mutations
        WHERE tenant_id = $1
          AND endpoint_key = $2
          AND mutation_id = $3
        "#,
    )
    .bind(tenant_id)
    .bind(endpoint_key)
    .bind(mutation_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(processed.map(replay_processed_mutation_response))
}

fn replay_processed_mutation_response(processed: ProcessedMutationResponse) -> Response {
    let status = StatusCode::from_u16(processed.response_status as u16).unwrap_or(StatusCode::OK);
    match processed.response_body {
        Some(body) => (status, Json(body)).into_response(),
        None => status.into_response(),
    }
}

pub async fn save_processed_mutation_response(
    pool: &PgPool,
    tenant_id: uuid::Uuid,
    endpoint_key: &str,
    mutation_id: &str,
    status: StatusCode,
    body: Option<serde_json::Value>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO processed_mutations (
            tenant_id,
            endpoint_key,
            mutation_id,
            response_status,
            response_body
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, endpoint_key, mutation_id) DO NOTHING
        "#,
    )
    .bind(tenant_id)
    .bind(endpoint_key)
    .bind(mutation_id)
    .bind(status.as_u16() as i32)
    .bind(body)
    .execute(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(())
}

pub async fn save_processed_mutation_response_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: uuid::Uuid,
    endpoint_key: &str,
    mutation_id: &str,
    status: StatusCode,
    body: Option<serde_json::Value>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO processed_mutations (
            tenant_id,
            endpoint_key,
            mutation_id,
            response_status,
            response_body
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, endpoint_key, mutation_id) DO NOTHING
        "#,
    )
    .bind(tenant_id)
    .bind(endpoint_key)
    .bind(mutation_id)
    .bind(status.as_u16() as i32)
    .bind(body)
    .execute(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(())
}
