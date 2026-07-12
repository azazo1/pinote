use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Clone)]
pub(crate) struct AuthToken([u8; 32]);

impl AuthToken {
    pub(crate) fn new(token: &str) -> Self {
        Self(Sha256::digest(token.as_bytes()).into())
    }

    fn matches(&self, headers: &HeaderMap) -> bool {
        let Some(value) = headers.get(header::AUTHORIZATION) else {
            return false;
        };
        let Ok(value) = value.to_str() else {
            return false;
        };
        let Some((scheme, token)) = value.split_once(' ') else {
            return false;
        };
        if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
            return false;
        }
        let candidate: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        bool::from(self.0.ct_eq(&candidate))
    }
}

pub(crate) async fn require_auth(
    State(token): State<AuthToken>,
    request: Request,
    next: Next,
) -> Response {
    if token.matches(request.headers()) {
        return next.run(request).await;
    }

    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Bearer")],
        axum::Json(serde_json::json!({ "error": "访问令牌无效" })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, header};

    use super::AuthToken;

    #[test]
    fn token_comparison_accepts_bearer_scheme_case_insensitively() {
        let token = AuthToken::new("correct-token");
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("bearer correct-token"));
        assert!(token.matches(&headers));

        headers.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer wrong-token"));
        assert!(!token.matches(&headers));
    }
}

