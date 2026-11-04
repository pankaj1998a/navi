use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::path::PathBuf;

pub struct StaticConfig {
    pub dist_dir: PathBuf,
}

pub async fn serve_static(config: std::sync::Arc<StaticConfig>, req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let target = if path.is_empty() {
        config.dist_dir.join("index.html")
    } else {
        config.dist_dir.join(path)
    };

    let file_to_serve = if target.is_file() {
        target
    } else {
        // SPA Fallback: non-matching routes fallback to index.html
        config.dist_dir.join("index.html")
    };

    if !file_to_serve.is_file() {
        return (StatusCode::NOT_FOUND, "Web UI assets not found").into_response();
    }

    match tokio::fs::read(&file_to_serve).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&file_to_serve).first_or_octet_stream();
            let mut res = Response::new(Body::from(bytes));
            
            let headers = res.headers_mut();
            if let Ok(val) = HeaderValue::from_str(mime.as_ref()) {
                headers.insert(header::CONTENT_TYPE, val);
            }

            // Security headers
            headers.insert(
                header::CONTENT_SECURITY_POLICY,
                HeaderValue::from_static("default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:;"),
            );
            headers.insert(
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            );
            headers.insert(
                header::X_FRAME_OPTIONS,
                HeaderValue::from_static("SAMEORIGIN"),
            );

            // Caching
            if file_to_serve.ends_with("index.html") {
                headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            } else if path.starts_with("assets/") {
                headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
            }

            res
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read asset").into_response(),
    }
}
