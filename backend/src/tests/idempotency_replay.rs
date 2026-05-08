// J — idempotency replay edge cases.
//
// Notes after reading the handler code:
//   * J1 ("replay returns the cached body even after the entity changed") is already
//     covered by D7. Skipped here.
//   * J2 ("first call returns a 4xx; second call returns the cached error") is FALSE in
//     this codebase: every handler that calls `save_processed_mutation_response*` does so
//     only on the success path. Validation/auth errors short-circuit before the cache is
//     written. Test J2 below documents this contract — replays after a 400 *re-execute*
//     the handler.
//   * J3 (concurrent same-key) cannot be exercised deterministically with a single sqlx
//     test connection. Skipped.
//   * J4 ("replay returns 204 with no body") covers the body=None branch of
//     `replay_processed_mutation_response`. Test J4 below uses
//     `DELETE /labeling/devices/{id}/photo` with no stored photo, which writes
//     `(204, None)` to processed_mutations and replays as 204.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// J2 — actual contract: error responses are NOT cached. A first call that 400s does not
// write to processed_mutations; a second call with the same mutation_id but valid body
// re-executes the handler and proceeds normally.
#[sqlx::test(migrator = "MIGRATOR")]
async fn j2_errors_are_not_cached_replay_re_executes(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();
    let mid = Uuid::new_v4().to_string();

    let invalid_body = json!({
        "shift_id": shift.id,
        "device_id": device.id,
        "status": "FOO_BAR",
        "started_at": "2026-01-01T00:00:00Z"
    });
    let valid_body = json!({
        "shift_id": shift.id,
        "device_id": device.id,
        "status": "IN_PROGRESS",
        "started_at": "2026-01-01T00:00:00Z"
    });

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(invalid_body),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let processed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM processed_mutations WHERE mutation_id = $1",
    )
    .bind(&mid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        processed_count, 0,
        "the 400 must not have written a processed_mutations row"
    );

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(valid_body),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "second call with the same mid but a valid body must re-execute (errors are not cached)"
    );
}

// J4 — replay of a 204-no-body response: the body=None branch of
// `replay_processed_mutation_response`. We exercise it via DELETE /labeling/devices/{id}/photo
// when the device has no photo: the handler writes (204, None) to processed_mutations and
// returns 204; the replay must return 204 with an empty body.
#[sqlx::test(migrator = "MIGRATOR")]
async fn j4_replay_204_no_body(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let mid = Uuid::new_v4().to_string();

    let router = build_router_with_fake_storage(pool.clone());

    let req1 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/labeling/devices/{}/photo", device.id))
        .header("Cookie", format!("noma_session={}", user.session_token))
        .header("X-Mutation-Id", &mid)
        .body(Body::empty())
        .unwrap();
    let (status1, body1) = call(&router, req1).await;
    assert_eq!(status1, StatusCode::NO_CONTENT);
    assert!(body1.is_empty(), "first 204 must have an empty body");

    // Confirm the response was cached.
    let processed_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM processed_mutations WHERE mutation_id = $1",
    )
    .bind(&mid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(processed_count, 1);

    // Replay: same mid, same path → cache hit, returns 204 via the body=None branch.
    let req2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/labeling/devices/{}/photo", device.id))
        .header("Cookie", format!("noma_session={}", user.session_token))
        .header("X-Mutation-Id", &mid)
        .body(Body::empty())
        .unwrap();
    let (status2, body2) = call(&router, req2).await;
    assert_eq!(status2, StatusCode::NO_CONTENT);
    assert!(body2.is_empty());
}

// Also assert that when an error mapper *does* save before returning (e.g., not the case
// in any current handler), this test would catch the regression. Today, the assertion
// holds the actual contract: validation errors share a mutation_id but each call that
// reaches a 400 re-runs the validator.
#[sqlx::test(migrator = "MIGRATOR")]
async fn j2b_repeated_400_each_executes_handler(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let mid = Uuid::new_v4().to_string();

    let bad_body = serde_json::json!({
        "shift_id": Uuid::new_v4(),
        "device_id": Uuid::new_v4(),
        "status": "FOO",
        "started_at": "2026-01-01T00:00:00Z"
    });

    let router = build_router(pool.clone());
    for _ in 0..2 {
        let (status, body) = call(
            &router,
            make_req(
                "POST",
                &format!("/maintenance/works/{}/sync", Uuid::new_v4()),
                &user.session_token,
                Some(&mid),
                Some(bad_body.clone()),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"], "invalid maintenance work status");
    }

    // Still no cached row.
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM processed_mutations WHERE mutation_id = $1",
    )
    .bind(&mid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}
