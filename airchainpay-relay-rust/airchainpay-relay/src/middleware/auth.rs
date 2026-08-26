//! Authentication & authorization middleware for the `/api` scope.
//!
//! This middleware closes a critical vulnerability: prior to its introduction
//! every `/api/*` route (including config export, backup/restore, audit
//! clearing and transaction submission) was reachable with no credentials.
//!
//! Behaviour:
//! - `OPTIONS` (CORS preflight) requests bypass auth.
//! - Paths listed in `exempt_paths` (e.g. `/api/auth/token`) bypass auth.
//! - A request is authenticated via EITHER a valid `X-API-Key` header
//!   (granting `Operator`) OR a valid `Authorization: Bearer <JWT>` whose
//!   `typ` claim maps to a role (`operator` => Operator, otherwise Client).
//! - Requests whose path starts with any `operator_only_prefixes` entry
//!   require the `Operator` role; all other authenticated roles are accepted.
//! - The middleware FAILS CLOSED: if neither credential type is enabled in
//!   configuration, every request is rejected with 401 (never allow-all).
//!
//! Secrets are never logged.

use actix_web::{
    dev::{Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpResponse,
};
use futures::future::{ready, Ready};
use futures_util::future::LocalBoxFuture;
use std::marker::PhantomData;
use std::sync::Arc;

use crate::domain::auth::AuthManager;

/// Role granted to an authenticated caller. `Operator` is a superset of
/// `Client` (it satisfies any endpoint that a `Client` can access).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Client,
    Operator,
}

impl Role {
    /// Returns true if `self` is allowed to access an endpoint that requires
    /// `required`.
    pub fn satisfies(self, required: Role) -> bool {
        match required {
            Role::Client => true, // any authenticated role may act as a client
            Role::Operator => self == Role::Operator,
        }
    }

    fn from_token_type(typ: &str) -> Role {
        if typ.eq_ignore_ascii_case("operator") {
            Role::Operator
        } else {
            Role::Client
        }
    }
}

/// Snapshot of the security-relevant configuration used to authenticate
/// requests. Captured once per worker from `config.security`.
#[derive(Clone)]
pub struct AuthConfig {
    pub enable_jwt_validation: bool,
    pub enable_api_key_validation: bool,
    pub jwt_secret: String,
    pub api_key: String,
    /// Full path prefixes (including the `/api` scope, e.g. `/api/config`)
    /// that require the `Operator` role.
    pub operator_only_prefixes: Vec<String>,
    /// Full paths that bypass authentication entirely (e.g. `/api/auth/token`).
    pub exempt_paths: Vec<String>,
}

impl AuthConfig {
    /// Default operator-only prefixes covering all administrative surfaces.
    pub fn default_operator_prefixes() -> Vec<String> {
        [
            "/api/config",
            "/api/backup",
            "/api/audit",
            "/api/error",
            "/api/devices",
            "/api/metrics",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect()
    }

    /// Default exempt paths (token minting must be reachable without a token).
    pub fn default_exempt_paths() -> Vec<String> {
        ["/api/auth/token"].iter().map(|s| s.to_string()).collect()
    }
}

use crate::domain::auth::constant_time_eq as ct_eq_bytes;

/// Constant-time string comparison (delegates to the shared byte comparison in
/// `domain::auth`) to avoid leaking secret content via timing.
fn constant_time_eq(a: &str, b: &str) -> bool {
    ct_eq_bytes(a.as_bytes(), b.as_bytes())
}

#[derive(Clone)]
pub struct AuthMiddleware {
    config: Arc<AuthConfig>,
}

impl AuthMiddleware {
    pub fn new(config: AuthConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }
}

pub struct AuthMiddlewareService<S, B> {
    service: Arc<S>,
    config: Arc<AuthConfig>,
    _phantom: PhantomData<B>,
}

impl<S, B> Transform<S, ServiceRequest> for AuthMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: actix_web::body::MessageBody + 'static,
{
    type Response = ServiceResponse<actix_web::body::BoxBody>;
    type Error = Error;
    type Transform = AuthMiddlewareService<S, B>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AuthMiddlewareService {
            service: Arc::new(service),
            config: Arc::clone(&self.config),
            _phantom: PhantomData,
        }))
    }
}

impl<S, B> Service<ServiceRequest> for AuthMiddlewareService<S, B>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: actix_web::body::MessageBody + 'static,
{
    type Response = ServiceResponse<actix_web::body::BoxBody>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(
        &self,
        cx: &mut futures::task::Context<'_>,
    ) -> futures::task::Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Arc::clone(&self.service);
        let config = Arc::clone(&self.config);

        Box::pin(async move {
            // 1. CORS preflight bypasses auth.
            if req.method() == actix_web::http::Method::OPTIONS {
                let res = service.call(req).await?;
                return Ok(res.map_into_boxed_body());
            }

            let path = req.path().to_string();

            // 2. Explicitly exempt paths (e.g. token minting).
            if config.exempt_paths.iter().any(|p| path == *p) {
                let res = service.call(req).await?;
                return Ok(res.map_into_boxed_body());
            }

            // 3. Authenticate. Determine the caller's role, if any.
            let role = authenticate(&req, &config);

            let role = match role {
                Some(role) => role,
                None => {
                    return Ok(req.into_response(
                        HttpResponse::Unauthorized()
                            .json(serde_json::json!({
                                "error": "unauthorized",
                                "message": "Missing or invalid credentials. Provide a valid X-API-Key or Authorization: Bearer <token>.",
                            }))
                            .map_into_boxed_body(),
                    ));
                }
            };

            // 4. Determine the role required for this path.
            let required = if config
                .operator_only_prefixes
                .iter()
                .any(|prefix| path.starts_with(prefix))
            {
                Role::Operator
            } else {
                Role::Client
            };

            // 5. Authorize.
            if !role.satisfies(required) {
                return Ok(req.into_response(
                    HttpResponse::Forbidden()
                        .json(serde_json::json!({
                            "error": "forbidden",
                            "message": "Operator role required for this endpoint.",
                        }))
                        .map_into_boxed_body(),
                ));
            }

            let res = service.call(req).await?;
            Ok(res.map_into_boxed_body())
        })
    }
}

/// Attempt to authenticate a request. Returns the granted [`Role`] or `None`.
///
/// Fails closed: if neither credential type is enabled, no request can
/// authenticate.
fn authenticate(req: &ServiceRequest, config: &AuthConfig) -> Option<Role> {
    // API key -> Operator (master credential).
    if config.enable_api_key_validation && !config.api_key.is_empty() {
        if let Some(provided) = req.headers().get("X-API-Key").and_then(|h| h.to_str().ok()) {
            if constant_time_eq(provided, &config.api_key) {
                return Some(Role::Operator);
            }
        }
    }

    // Bearer JWT -> role from `typ` claim.
    if config.enable_jwt_validation && !config.jwt_secret.is_empty() {
        if let Some(auth_header) = req
            .headers()
            .get(actix_web::http::header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
        {
            if let Some(token) = auth_header.strip_prefix("Bearer ") {
                if let Ok(claims) =
                    AuthManager::verify_jwt_token_with_secret(token.trim(), &config.jwt_secret)
                {
                    return Some(Role::from_token_type(&claims.typ));
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config() -> AuthConfig {
        AuthConfig {
            enable_jwt_validation: true,
            enable_api_key_validation: true,
            jwt_secret: "unit_test_secret_value_1234567890abcdef".to_string(),
            api_key: "unit_test_api_key_abcdef1234567890".to_string(),
            operator_only_prefixes: AuthConfig::default_operator_prefixes(),
            exempt_paths: AuthConfig::default_exempt_paths(),
        }
    }

    #[test]
    fn role_hierarchy() {
        assert!(Role::Operator.satisfies(Role::Client));
        assert!(Role::Operator.satisfies(Role::Operator));
        assert!(Role::Client.satisfies(Role::Client));
        assert!(!Role::Client.satisfies(Role::Operator));
    }

    #[test]
    fn constant_time_eq_behaviour() {
        let cfg = base_config();
        assert!(constant_time_eq(&cfg.api_key, "unit_test_api_key_abcdef1234567890"));
        assert!(!constant_time_eq(&cfg.api_key, "wrong"));
        assert!(!constant_time_eq(&cfg.api_key, "unit_test_api_key_abcdef1234567891"));
    }

    #[test]
    fn token_type_maps_to_role() {
        assert_eq!(Role::from_token_type("operator"), Role::Operator);
        assert_eq!(Role::from_token_type("OPERATOR"), Role::Operator);
        assert_eq!(Role::from_token_type("client"), Role::Client);
        assert_eq!(Role::from_token_type("relay"), Role::Client);
    }

    #[test]
    fn operator_prefix_matching() {
        let cfg = base_config();
        let is_operator_only = |path: &str| {
            cfg.operator_only_prefixes
                .iter()
                .any(|p| path.starts_with(p))
        };
        assert!(is_operator_only("/api/config/export"));
        assert!(is_operator_only("/api/backup/create"));
        assert!(is_operator_only("/api/audit/events"));
        assert!(!is_operator_only("/api/send_tx"));
        assert!(!is_operator_only("/api/transactions"));
    }

    #[test]
    fn jwt_round_trip_with_configured_secret() {
        let cfg = base_config();
        let operator_token =
            AuthManager::generate_jwt_token_with_secret("op", "operator", &cfg.jwt_secret);
        let client_token =
            AuthManager::generate_jwt_token_with_secret("cl", "client", &cfg.jwt_secret);

        let op_claims =
            AuthManager::verify_jwt_token_with_secret(&operator_token, &cfg.jwt_secret).unwrap();
        assert_eq!(Role::from_token_type(&op_claims.typ), Role::Operator);

        let cl_claims =
            AuthManager::verify_jwt_token_with_secret(&client_token, &cfg.jwt_secret).unwrap();
        assert_eq!(Role::from_token_type(&cl_claims.typ), Role::Client);

        // A token signed with a different secret must not verify.
        assert!(
            AuthManager::verify_jwt_token_with_secret(&operator_token, "a_different_secret").is_err()
        );
    }
}
