use axum::{
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::sync::Arc;
use subtle::ConstantTimeEq;

pub struct AuthConfig {
    pub enabled: bool,
    pub username: String,
    pub password: String,
}

pub fn is_public_asset(path: &str) -> bool {
    path.starts_with("/assets/")
        || path == "/"
        || path == "/index.html"
        || path.ends_with(".js")
        || path.ends_with(".css")
        || path.ends_with(".ico")
        || path.ends_with(".svg")
        || path.ends_with(".png")
        || path.ends_with(".woff")
        || path.ends_with(".woff2")
        || path.ends_with(".ttf")
        || path.ends_with(".aac")
        || path.ends_with(".webmanifest")
        || matches!(
            path,
            "/site.webmanifest"
                | "/web-app-manifest-192x192.png"
                | "/web-app-manifest-512x512.png"
                | "/favicon.ico"
                | "/favicon.svg"
                | "/favicon-v3.ico"
                | "/favicon-v3.svg"
                | "/apple-touch-icon.png"
                | "/apple-touch-icon-v3.png"
        )
}

fn extract_credentials(req: &Request) -> Option<(String, String)> {
    // 1. Check Authorization header
    if let Some(auth_val) = req.headers().get(header::AUTHORIZATION) {
        if let Ok(auth_str) = auth_val.to_str() {
            if let Some(token) = auth_str.strip_prefix("Basic ") {
                if let Ok(decoded) = BASE64.decode(token.trim()) {
                    if let Ok(cred) = String::from_utf8(decoded) {
                        if let Some((u, p)) = cred.split_once(':') {
                            return Some((u.to_string(), p.to_string()));
                        }
                    }
                }
            }
        }
    }

    // 2. Check query parameter ?auth_token=...
    if let Some(query) = req.uri().query() {
        for param in query.split('&') {
            if let Some(token) = param.strip_prefix("auth_token=") {
                let token = urlencoding_decode(token);
                if let Ok(decoded) = BASE64.decode(&token) {
                    if let Ok(cred) = String::from_utf8(decoded) {
                        if let Some((u, p)) = cred.split_once(':') {
                            return Some((u.to_string(), p.to_string()));
                        }
                    }
                }
            }
        }
    }

    None
}

fn urlencoding_decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            let h1 = chars.next().unwrap_or('0');
            let h2 = chars.next().unwrap_or('0');
            if let Ok(b) = u8::from_str_radix(&format!("{}{}", h1, h2), 16) {
                out.push(b as char);
            }
        } else if ch == '+' {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out
}

pub async fn auth_middleware(
    config: Arc<AuthConfig>,
    req: Request,
    next: Next,
) -> Response {
    if !config.enabled {
        return next.run(req).await;
    }

    let path = req.uri().path();
    if is_public_asset(path) {
        return next.run(req).await;
    }

    if let Some((user, pass)) = extract_credentials(&req) {
        let user_eq = user.as_bytes().ct_eq(config.username.as_bytes()).unwrap_u8() == 1;
        let pass_eq = pass.as_bytes().ct_eq(config.password.as_bytes()).unwrap_u8() == 1;

        if user_eq && pass_eq {
            return next.run(req).await;
        }
    }

    let mut res = StatusCode::UNAUTHORIZED.into_response();
    res.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Basic realm=\"Secure Area\""),
    );
    res
}
