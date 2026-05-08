// I — Database trigger and partial-index behavior.
// These tests exercise the schema directly (raw SQL) — no HTTP, no handlers — so they catch
// the case where handler code starts allowing something the DB still forbids. The handlers
// are the first line of defense; these are the safety net under them.

use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// I1 — Inserting a participant into a READY_TO_COMMIT shift is rejected by the participants
// trigger ("Participants cannot be added to or reassigned into a frozen shift.").
#[sqlx::test(migrator = "MIGRATOR")]
async fn i1_insert_participant_into_ready_to_commit_shift_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let new_user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "READY_TO_COMMIT").await;

    let err = sqlx::query(
        "INSERT INTO shift_participants (tenant_id, shift_id, user_id, status) \
         VALUES ($1, $2, $3, 'INVITED')",
    )
    .bind(tenant.id)
    .bind(shift.id)
    .bind(new_user.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("Participants cannot be added"),
        "expected frozen-shift trigger, got: {err}"
    );
}

// I2 — Updating a participant's status on a COMMITTED shift is rejected.
#[sqlx::test(migrator = "MIGRATOR")]
async fn i2_update_participant_on_committed_shift_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "COMMITTED").await;

    let err = sqlx::query(
        "UPDATE shift_participants SET status = 'DECLINED' \
         WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("Participants of a frozen shift"),
        "expected frozen-shift trigger, got: {err}"
    );
}

// I3 — Deleting a participant row from a CANCELLED shift is rejected. (Set up by inserting
// IN_PROGRESS, then transitioning to CANCELLED — the shift-level trigger allows that path.)
#[sqlx::test(migrator = "MIGRATOR")]
async fn i3_delete_participant_from_cancelled_shift_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await; // IN_PROGRESS

    sqlx::query("UPDATE shifts SET status = 'CANCELLED' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let err = sqlx::query(
        "DELETE FROM shift_participants WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("Participants of a frozen shift"),
        "expected frozen-shift trigger, got: {err}"
    );
}

// I4 — Inserting a maintenance_works row into a CANCELLED shift is rejected.
// (For READY_TO_COMMIT/COMMITTED the maintenance trigger only freezes once report_url is set,
// so we use CANCELLED here for an unambiguous trigger-raises assertion.)
#[sqlx::test(migrator = "MIGRATOR")]
async fn i4_insert_maintenance_into_cancelled_shift_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    sqlx::query("UPDATE shifts SET status = 'CANCELLED' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let err = sqlx::query(
        "INSERT INTO maintenance_works (tenant_id, shift_id, device_id, maintainer_user_id) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("Maintenance works"),
        "expected frozen-maintenance trigger, got: {err}"
    );
}

// I5 — Inserting a maintenance_photos row whose parent work belongs to a frozen shift is
// rejected. We seed a work on a live shift, then freeze the shift, then attempt the photo
// insert.
#[sqlx::test(migrator = "MIGRATOR")]
async fn i5_insert_photo_when_parent_shift_is_frozen_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let work_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO maintenance_works \
         (id, tenant_id, shift_id, device_id, maintainer_user_id, status, finished_at) \
         VALUES ($1, $2, $3, $4, $5, 'FINISHED', NOW())",
    )
    .bind(work_id)
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("UPDATE shifts SET status = 'CANCELLED' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let err = sqlx::query(
        "INSERT INTO maintenance_photos (tenant_id, maintenance_work_id, photo_url) \
         VALUES ($1, $2, '/x.jpg')",
    )
    .bind(tenant.id)
    .bind(work_id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("Maintenance photos"),
        "expected frozen-photos trigger, got: {err}"
    );
}

// I6 — Updating building_id on a READY_TO_COMMIT shift is rejected. The trigger explicitly
// blocks any non-commit-related field from changing once the shift is ready to commit.
#[sqlx::test(migrator = "MIGRATOR")]
async fn i6_update_building_id_on_ready_to_commit_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building_a = seed_building(&pool, tenant.id).await;
    let building_b = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building_a.id, lead.id, "READY_TO_COMMIT").await;

    let err = sqlx::query("UPDATE shifts SET building_id = $1 WHERE id = $2")
        .bind(building_b.id)
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap_err();

    assert!(
        err.to_string().contains("Ready-to-commit shifts only allow"),
        "expected ready-to-commit field-lock trigger, got: {err}"
    );
}

// I7 — Setting report_url for the first time on a COMMITTED shift is allowed (this is exactly
// the one-shot exception the trigger carves out for post-commit summary publishing).
#[sqlx::test(migrator = "MIGRATOR")]
async fn i7_set_report_url_first_time_on_committed_succeeds(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "COMMITTED").await;

    let result = sqlx::query("UPDATE shifts SET report_url = 'https://x/r.pdf' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await;
    assert!(result.is_ok(), "first report_url set must be allowed: {result:?}");

    let stored: Option<String> =
        sqlx::query_scalar("SELECT report_url FROM shifts WHERE id = $1")
            .bind(shift.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored.as_deref(), Some("https://x/r.pdf"));
}

// I8 — Once a COMMITTED shift has a report_url, changing it (or any other field) is rejected.
#[sqlx::test(migrator = "MIGRATOR")]
async fn i8_change_report_url_on_committed_with_existing_raises(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "COMMITTED").await;

    sqlx::query("UPDATE shifts SET report_url = 'https://x/first.pdf' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let err = sqlx::query("UPDATE shifts SET report_url = 'https://x/second.pdf' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap_err();

    assert!(
        err.to_string().contains("report_url cannot be modified"),
        "expected report_url-locked trigger, got: {err}"
    );
}

// I9 — Two IN_PROGRESS maintenance_works rows for the same maintainer (any device) are
// blocked by the partial unique index `maintenance_works_one_active_per_user_idx`. This is
// the safety net behind the F3.4 handler-level check.
#[sqlx::test(migrator = "MIGRATOR")]
async fn i9_two_in_progress_works_for_same_user_violates_unique_index(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device_a = seed_device(&pool, tenant.id, building.id).await;
    let device_b = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    sqlx::query(
        "INSERT INTO maintenance_works (tenant_id, shift_id, device_id, maintainer_user_id) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device_a.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap();

    let err = sqlx::query(
        "INSERT INTO maintenance_works (tenant_id, shift_id, device_id, maintainer_user_id) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device_b.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("maintenance_works_one_active_per_user_idx"),
        "expected per-user unique-index violation, got: {err}"
    );
}

// I10 — Two IN_PROGRESS maintenance_works for the same device (different maintainers) are
// blocked by `maintenance_works_one_active_per_device_idx`.
#[sqlx::test(migrator = "MIGRATOR")]
async fn i10_two_in_progress_works_for_same_device_violates_unique_index(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, other.id, "CACHE_READY").await;

    sqlx::query(
        "INSERT INTO maintenance_works (tenant_id, shift_id, device_id, maintainer_user_id) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap();

    let err = sqlx::query(
        "INSERT INTO maintenance_works (tenant_id, shift_id, device_id, maintainer_user_id) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device.id)
    .bind(other.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("maintenance_works_one_active_per_device_idx"),
        "expected per-device unique-index violation, got: {err}"
    );
}

// I11 — Two active barcodes for one device are blocked by `barcodes_one_active_per_device_idx`
// (the partial unique index over device_id WHERE deactivated_at IS NULL).
#[sqlx::test(migrator = "MIGRATOR")]
async fn i11_two_active_barcodes_for_one_device_violates_unique_index(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    sqlx::query("INSERT INTO barcodes (tenant_id, device_id, code) VALUES ($1, $2, 'CODE-A')")
        .bind(tenant.id)
        .bind(device.id)
        .execute(&pool)
        .await
        .unwrap();

    let err = sqlx::query(
        "INSERT INTO barcodes (tenant_id, device_id, code) VALUES ($1, $2, 'CODE-B')",
    )
    .bind(tenant.id)
    .bind(device.id)
    .execute(&pool)
    .await
    .unwrap_err();

    assert!(
        err.to_string().contains("barcodes_one_active_per_device_idx"),
        "expected per-device active-barcode unique-index violation, got: {err}"
    );
}
