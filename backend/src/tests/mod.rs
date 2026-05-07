pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

mod helpers;
mod idempotency;
mod roles;
mod tenancy;
