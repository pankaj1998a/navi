mod auth;
mod events;
mod pty;
mod static_files;

use auth::{auth_middleware, AuthConfig};
use axum::{
    middleware,
    response::Json,
    routing::{any, get},
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use clap::Parser;
use events::EventBus;
use serde_json::json;
use static_files::StaticConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

#[derive(Parser, Debug)]
#[command(name = "navi-web", version = "0.1.0", about = "Navi Native High-Performance Web & PTY Server")]
struct Cli {
    #[arg(short, long, default_value = "4096")]
    port: u16,

    #[arg(short = 'H', long, default_value = "127.0.0.1")]
    hostname: String,

    #[arg(long)]
    password: Option<String>,

    #[arg(long, default_value_t = false)]
    no_auth: bool,

    #[arg(long)]
    dist_dir: Option<PathBuf>,

    #[arg(long, default_value_t = false)]
    open: bool,

    #[arg(long, default_value_t = false)]
    json: bool,
}

fn find_dist_dir(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(p) = explicit {
        if p.exists() {
            return p;
        }
    }

    if let Ok(env_path) = std::env::var("NAVI_APP_DIST") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return p;
        }
    }

    let candidates = [
        PathBuf::from(r"V:\pankaj\navi\packages\app\dist"),
        PathBuf::from("packages/app/dist"),
        PathBuf::from("../../packages/app/dist"),
        PathBuf::from("dist"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("../../packages/app/dist")))
            .unwrap_or_default(),
    ];

    for candidate in candidates {
        if candidate.join("index.html").exists() {
            return candidate;
        }
    }

    PathBuf::from("packages/app/dist")
}

fn open_browser(url: &str) {
    if cfg!(target_os = "windows") {
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("Start-Process '{}'", url)])
            .spawn();
    } else if cfg!(target_os = "macos") {
        let _ = std::process::Command::new("open").arg(url).spawn();
    } else {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Cli::parse();

    let dist_dir = find_dist_dir(args.dist_dir);

    let (auth_enabled, password) = if args.no_auth {
        (false, String::new())
    } else if let Some(pass) = args.password {
        (true, pass)
    } else {
        // Generate ephemeral password
        (true, uuid::Uuid::new_v4().to_string())
    };

    let username = std::env::var("NAVI_SERVER_USERNAME").unwrap_or_else(|_| "navi".to_string());

    let auth_config = Arc::new(AuthConfig {
        enabled: auth_enabled,
        username: username.clone(),
        password: password.clone(),
    });

    let static_config = Arc::new(StaticConfig { dist_dir });
    let event_bus = Arc::new(EventBus::new(256));

    let auth_mid_cfg = auth_config.clone();

    // Build routes
    let app = Router::new()
        .route("/api/health", get(|| async {
            Json(json!({
                "status": "ok",
                "engine": "navi-web-rust",
                "version": "0.1.0"
            }))
        }))
        .route("/global/health", get(|| async {
            Json(json!({
                "healthy": true,
                "version": "2.0.0"
            }))
        }))
        .route("/pty", get(pty::handle_pty_ws))
        .route("/terminal", get(pty::handle_pty_ws))
        .route("/events", get({
            let bus = event_bus.clone();
            move || events::handle_events_sse(bus)
        }))
        .fallback(any({
            let s_cfg = static_config.clone();
            move |req| static_files::serve_static(s_cfg, req)
        }))
        .layer(middleware::from_fn(move |req, next| {
            auth_middleware(auth_mid_cfg.clone(), req, next)
        }))
        .layer(CorsLayer::permissive());

    let addr: SocketAddr = format!("{}:{}", args.hostname, args.port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound_addr = listener.local_addr()?;

    let port = bound_addr.port();
    let base_url = format!("http://{}:{}", args.hostname, port);

    let auth_query = if auth_enabled {
        let cred = format!("{}:{}", username, password);
        let token = BASE64.encode(cred.as_bytes());
        format!("?auth_token={}", token)
    } else {
        String::new()
    };

    let authenticated_url = format!("{}{}", base_url, auth_query);

    if args.json {
        let out = json!({
            "status": "listening",
            "hostname": args.hostname,
            "port": port,
            "password": if auth_enabled { Some(&password) } else { None },
            "username": if auth_enabled { Some(&username) } else { None },
            "url": base_url,
            "authenticated_url": authenticated_url,
            "engine": "navi-web-rust"
        });
        println!("{}", serde_json::to_string(&out).unwrap());
    } else {
        println!("+-------------------------------------------------------+");
        println!("|           NAVI NATIVE WEB ENGINE (RUST)              |");
        println!("+-------------------------------------------------------+");
        println!("  Local access:     {}", base_url);
        if auth_enabled {
            println!("  Username:         {}", username);
            println!("  Password:         {}", password);
            println!("  Authenticated:    {}", authenticated_url);
        } else {
            println!("  Authentication:   DISABLED (unsecured)");
        }
        println!("+-------------------------------------------------------+");
    }

    if args.open {
        open_browser(&authenticated_url);
    }

    axum::serve(listener, app).await?;
    Ok(())
}
