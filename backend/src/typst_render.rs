use anyhow::{Context, anyhow};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::multipart::Form;
use serde::Deserialize;
use std::fs;
use std::sync::Arc;

const SERVICE_URL_ENV_CANDIDATES: &[&str] = &[
    "WORKSHEET_PDF_SERVICE_URL",
    "TYPST_PDF_SERVICE_URL",
    "LABEL_PDF_SERVICE_URL",
];
const SERVICE_AUDIENCE_ENV_CANDIDATES: &[&str] = &[
    "WORKSHEET_PDF_SERVICE_AUDIENCE",
    "TYPST_PDF_SERVICE_AUDIENCE",
    "LABEL_PDF_SERVICE_AUDIENCE",
];
const SERVICE_ACCOUNT_ENV_CANDIDATES: &[&str] = &[
    "WORKSHEET_PDF_SERVICE_ACCOUNT_JSON",
    "TYPST_PDF_SERVICE_ACCOUNT_JSON",
    "LABEL_PDF_SERVICE_ACCOUNT_JSON",
];

#[derive(Clone)]
pub struct TypstRenderClient {
    base_url: String,
    token_audience: String,
    token_uri: String,
    client_email: String,
    private_key_id: Option<String>,
    encoding_key: Arc<EncodingKey>,
    http_client: reqwest::Client,
}

impl TypstRenderClient {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let Some(base_url) = first_nonempty_env(SERVICE_URL_ENV_CANDIDATES) else {
            log::warn!(
                "Typst render service is not configured; worksheet generation will be unavailable. Set one of {:?} and one of {:?} (or the LABEL_PDF_* equivalents) to enable it.",
                SERVICE_URL_ENV_CANDIDATES,
                SERVICE_ACCOUNT_ENV_CANDIDATES,
            );
            return Ok(None);
        };

        log::info!("Typst render service configured at {}", base_url);

        let token_audience = first_nonempty_env(SERVICE_AUDIENCE_ENV_CANDIDATES)
            .unwrap_or_else(|| base_url.clone());
        let raw_service_account = first_nonempty_env(SERVICE_ACCOUNT_ENV_CANDIDATES)
            .ok_or_else(|| anyhow!("typst render service account JSON is not configured"))?;
        let (service_account_json, account_source) = load_service_account_json(&raw_service_account)
            .context("failed to read typst render service account JSON")?;
        log::info!("Loaded typst render service account from {}", account_source);

        let service_account: ServiceAccountKey = serde_json::from_str(&service_account_json)
            .context("failed to parse typst render service account JSON")?;
        let token_uri = service_account
            .token_uri
            .unwrap_or_else(|| "https://oauth2.googleapis.com/token".to_string());

        let encoding_key = Arc::new(
            EncodingKey::from_rsa_pem(service_account.private_key.as_bytes())
                .context("invalid RSA private key for typst render service")?,
        );

        let http_client = reqwest::Client::builder()
            .user_agent("noma_maintenance-backend/typst-renderer")
            .build()
            .context("failed to build HTTP client for typst rendering")?;

        Ok(Some(Self {
            base_url,
            token_audience,
            token_uri,
            client_email: service_account.client_email,
            private_key_id: service_account.private_key_id,
            encoding_key,
            http_client,
        }))
    }

    pub async fn render_typst(&self, form: Form) -> anyhow::Result<Vec<u8>> {
        let endpoint = format!("{}/generate-multipart", self.base_url.trim_end_matches('/'));
        let id_token = self.fetch_id_token().await?;

        let response = self
            .http_client
            .post(endpoint)
            .bearer_auth(id_token)
            .multipart(form)
            .send()
            .await
            .context("failed to call typst render service")?;

        let status = response.status();
        let body = response
            .bytes()
            .await
            .context("failed to read typst render service response")?;

        if !status.is_success() {
            let body_text = String::from_utf8_lossy(&body);
            anyhow::bail!("typst render service returned {}: {}", status, body_text);
        }

        Ok(body.to_vec())
    }

    async fn fetch_id_token(&self) -> anyhow::Result<String> {
        let now = chrono::Utc::now();
        let expiration = now + chrono::Duration::minutes(55);

        let claims = ServiceAccountClaims {
            iss: &self.client_email,
            sub: &self.client_email,
            aud: &self.token_uri,
            iat: now.timestamp() as usize,
            exp: expiration.timestamp() as usize,
            target_audience: &self.token_audience,
        };

        let mut header = Header::new(Algorithm::RS256);
        header.kid = self.private_key_id.clone();

        let assertion = jsonwebtoken::encode(&header, &claims, self.encoding_key.as_ref())
            .context("failed to sign identity token assertion for typst rendering")?;

        let response = self
            .http_client
            .post(&self.token_uri)
            .form(&[
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:jwt-bearer".to_string(),
                ),
                ("assertion", assertion),
            ])
            .send()
            .await
            .context("failed to request identity token for typst rendering")?;

        let status = response.status();
        let body = response
            .bytes()
            .await
            .context("failed to read identity token response body")?;

        if !status.is_success() {
            let body_text = String::from_utf8_lossy(&body);
            anyhow::bail!("identity token endpoint returned {}: {}", status, body_text);
        }

        let token_response: TokenResponse = serde_json::from_slice(&body)
            .context("failed to parse identity token response body")?;

        Ok(token_response.id_token)
    }
}

#[derive(Deserialize)]
struct ServiceAccountKey {
    client_email: String,
    private_key: String,
    token_uri: Option<String>,
    private_key_id: Option<String>,
}

#[derive(serde::Serialize)]
struct ServiceAccountClaims<'a> {
    iss: &'a str,
    sub: &'a str,
    aud: &'a str,
    iat: usize,
    exp: usize,
    target_audience: &'a str,
}

#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
}

fn first_nonempty_env(candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

fn load_service_account_json(raw_value: &str) -> anyhow::Result<(String, String)> {
    let trimmed = raw_value.trim();
    if trimmed.starts_with('{') {
        serde_json::from_str::<serde_json::Value>(trimmed)
            .context("inline JSON is not valid service account JSON")?;
        return Ok((trimmed.to_string(), "inline environment value".to_string()));
    }

    let path = std::path::Path::new(trimmed);
    if path.exists() {
        let contents = fs::read_to_string(path).with_context(|| {
            format!("failed to read service account file from {}", path.display())
        })?;
        return Ok((contents, format!("file {}", path.display())));
    }

    Err(anyhow!(
        "typst render service account JSON should be a JSON string or path to a JSON key file"
    ))
}
