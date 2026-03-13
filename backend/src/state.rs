use chrono::Duration;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub client: reqwest::Client,
    pub db_pool: Option<PgPool>,
    pub storage: Option<StorageConfig>,
    pub auth: Option<AuthConfig>,
}

#[derive(Clone)]
pub struct AuthConfig {
    pub google_client_ids: Vec<String>,
    pub google_hosted_domain: Option<String>,
    pub session_cookie_name: String,
    pub session_duration: Duration,
    pub cookie_secure: bool,
}

#[derive(Clone)]
pub struct StorageConfig {
    pub bucket: String,
    pub device_photo_prefix: String,
    pub shift_signature_prefix: String,
}

pub fn load_storage_config() -> anyhow::Result<Option<StorageConfig>> {
    let Some(bucket) = std::env::var("GCS_BUCKET")
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };

    let has_valid_service_account_path = std::env::var("SERVICE_ACCOUNT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|path| std::path::Path::new(&path).is_file())
        .unwrap_or(false);

    if !has_valid_service_account_path {
        if let Some(service_account_json) = std::env::var("GCS_SERVICE_ACCOUNT_JSON")
            .ok()
            .filter(|value| !value.trim().is_empty())
        {
            let temp_file = std::env::temp_dir().join(format!(
                "noma-gcs-service-account-{}.json",
                std::process::id()
            ));
            std::fs::write(&temp_file, service_account_json)?;
            // Safe at startup before worker threads begin handling requests.
            unsafe { std::env::set_var("SERVICE_ACCOUNT", &temp_file) };
        }
    }

    let service_account_path = std::env::var("SERVICE_ACCOUNT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "GCS_BUCKET is set but SERVICE_ACCOUNT is missing. Set SERVICE_ACCOUNT to a valid JSON key path or provide GCS_SERVICE_ACCOUNT_JSON."
            )
        })?;

    if !std::path::Path::new(&service_account_path).is_file() {
        anyhow::bail!(
            "SERVICE_ACCOUNT file not found: {}. Set a valid path or provide GCS_SERVICE_ACCOUNT_JSON.",
            service_account_path
        );
    }

    let device_photo_prefix = std::env::var("GCS_DEVICE_PHOTO_PREFIX")
        .unwrap_or_else(|_| "device-photos".to_string())
        .trim_matches('/')
        .to_string();

    let shift_signature_prefix = std::env::var("GCS_SHIFT_SIGNATURE_PREFIX")
        .unwrap_or_else(|_| "shift-signatures".to_string())
        .trim_matches('/')
        .to_string();

    Ok(Some(StorageConfig {
        bucket,
        device_photo_prefix,
        shift_signature_prefix,
    }))
}

pub fn load_google_client_ids() -> Vec<String> {
    let mut client_ids = Vec::new();

    for value in [
        std::env::var("GOOGLE_CLIENT_IDS").ok(),
        std::env::var("GOOGLE_CLIENT_ID").ok(),
        std::env::var("MAIN_GOOGLE_CLIENT_ID").ok(),
        std::env::var("LABELING_GOOGLE_CLIENT_ID").ok(),
    ]
    .into_iter()
    .flatten()
    {
        for client_id in value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if !client_ids.iter().any(|existing| existing == client_id) {
                client_ids.push(client_id.to_string());
            }
        }
    }

    client_ids
}
