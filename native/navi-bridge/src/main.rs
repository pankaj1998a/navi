use clap::{Parser, Subcommand};
use std::process;

mod auth;
mod client;
mod daemon;
mod mcp;
mod protocol;

use auth::{get_token_path, load_or_generate_token};
use client::{call_bridge_tool, check_daemon_status};
use daemon::BridgeDaemon;

#[derive(Parser)]
#[command(name = "navi-bridge", author, version, about = "NaviBridge local background daemon, CLI router and MCP server", long_about = None)]
struct Cli {
    #[arg(short, long, default_value_t = 10086)]
    port: u16,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the local background bridge daemon (default command)
    Serve {
        #[arg(short, long, default_value_t = 10086)]
        port: u16,
    },
    /// Query a logged-in web AI from the terminal (e.g., chatgpt, claude, deepseek)
    Ask {
        /// Prompt to send to the browser AI
        prompt: String,
        /// Provider ID: chatgpt, claude, deepseek, gemini, grok, kimi, perplexity
        #[arg(short, long, default_value = "chatgpt")]
        provider: String,
        /// Timeout in seconds
        #[arg(short, long, default_value_t = 60)]
        timeout: u64,
    },
    /// Inspect bridge daemon and Chrome extension connection status
    Doctor,
    /// Quick status check of the local bridge daemon
    Status,
    /// Print the local bridge auth token and token path
    Token,
    /// Run as an MCP (Model Context Protocol) stdio server
    Mcp,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let port = cli.port;

    match cli.command.unwrap_or(Commands::Serve { port }) {
        Commands::Serve { port } => {
            let token = load_or_generate_token();
            let daemon = BridgeDaemon::new(port, token);
            if let Err(e) = daemon.run().await {
                eprintln!("[navi-bridge] Daemon exited with error: {}", e);
                process::exit(1);
            }
        }
        Commands::Ask { prompt, provider, timeout } => {
            let token = load_or_generate_token();
            let args = serde_json::json!({
                "prompt": prompt,
                "provider": provider,
                "timeoutMs": timeout * 1000
            });

            match call_bridge_tool(port, &token, "ask", args, timeout + 5).await {
                Ok(res) => {
                    if let Some(text) = res.get("text").and_then(|t| t.as_str()) {
                        println!("{}", text);
                    } else if let Some(s) = res.as_str() {
                        println!("{}", s);
                    } else {
                        println!("{}", serde_json::to_string_pretty(&res).unwrap_or_default());
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    process::exit(1);
                }
            }
        }
        Commands::Doctor => {
            match check_daemon_status(port).await {
                Ok(status) => {
                    let connected = status.get("connected").and_then(|c| c.as_bool()).unwrap_or(false);
                    let clients_count = status.get("clientsCount").and_then(|c| c.as_u64()).unwrap_or(0);

                    println!("✓ NaviBridge Daemon: Online (http://127.0.0.1:{})", port);
                    if connected {
                        println!("✓ Chrome Extension: Connected ({} active link{})", clients_count, if clients_count > 1 { "s" } else { "" });
                        println!("  Ready to serve CLI queries via `navi ask` or `--model bridge/<provider>`");
                    } else {
                        println!("✗ Chrome Extension: Not connected");
                        println!("  Ensure Chrome is running with NaviBridge extension loaded and Link CLI enabled.");
                    }
                }
                Err(e) => {
                    eprintln!("✗ NaviBridge Daemon: Offline ({})", e);
                    eprintln!("  Run `navi bridge start` to start the daemon.");
                    process::exit(1);
                }
            }
        }
        Commands::Status => {
            match check_daemon_status(port).await {
                Ok(status) => println!("{}", serde_json::to_string_pretty(&status).unwrap_or_default()),
                Err(e) => {
                    eprintln!("Status check failed: {}", e);
                    process::exit(1);
                }
            }
        }
        Commands::Token => {
            let token = load_or_generate_token();
            let path = get_token_path();
            println!("Bridge Token: {}", token);
            println!("Token Path:   {}", path.display());
        }
        Commands::Mcp => {
            if let Err(e) = mcp::run_mcp_server(port).await {
                eprintln!("[mcp] Error: {}", e);
                process::exit(1);
            }
        }
    }
}
