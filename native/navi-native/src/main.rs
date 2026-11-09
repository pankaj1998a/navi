use std::io::{self, Read};
use std::path::PathBuf;

use navi_native_cli::{
    binary_inspect, code_graph, compactor, fuzzy_replace, patch, sanitizer, structure,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: navi-native <apply-patch|fuzzy-replace|code-graph|scrub|inspect-command|line-count|structure|bpe-tokens|compact|inspect-binary> [args...]");
        std::process::exit(1);
    }

    match args[1].as_str() {
        "apply-patch" => {
            let root_dir = if args.len() >= 3 {
                PathBuf::from(&args[2])
            } else {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            };

            let mut patch_content = String::new();
            if let Err(e) = io::stdin().read_to_string(&mut patch_content) {
                let err_res = patch::PatchResult {
                    success: false,
                    modified_files: Vec::new(),
                    added_files: Vec::new(),
                    deleted_files: Vec::new(),
                    diff: String::new(),
                    error: Some(format!("Failed to read patch from stdin: {}", e)),
                };
                println!(
                    "{}",
                    serde_json::to_string(&err_res).expect("serializing patch error result")
                );
                std::process::exit(1);
            }

            let result = patch::execute_patch(&root_dir, &patch_content);
            println!(
                "{}",
                serde_json::to_string(&result).expect("serializing patch result")
            );
            if !result.success {
                std::process::exit(1);
            }
        }
        "fuzzy-replace" => {
            let mut input = String::new();
            if let Err(e) = io::stdin().read_to_string(&mut input) {
                let resp = fuzzy_replace::FuzzyReplaceResponse {
                    success: false,
                    result: None,
                    strategy: None,
                    matches_count: 0,
                    error: Some(format!("Failed to read stdin: {}", e)),
                };
                println!(
                    "{}",
                    serde_json::to_string(&resp).expect("serializing error response")
                );
                std::process::exit(1);
            }

            match serde_json::from_str::<fuzzy_replace::FuzzyReplaceRequest>(&input) {
                Ok(req) => {
                    match fuzzy_replace::fuzzy_replace(
                        &req.content,
                        &req.old_string,
                        &req.new_string,
                        req.replace_all,
                    ) {
                        Ok(out) => {
                            let resp = fuzzy_replace::FuzzyReplaceResponse {
                                success: true,
                                result: Some(out.new_content),
                                strategy: Some(out.strategy.to_string()),
                                matches_count: out.matches_count,
                                error: None,
                            };
                            println!(
                                "{}",
                                serde_json::to_string(&resp)
                                    .expect("serializing fuzzy_replace response")
                            );
                        }
                        Err(err) => {
                            let resp = fuzzy_replace::FuzzyReplaceResponse {
                                success: false,
                                result: None,
                                strategy: None,
                                matches_count: 0,
                                error: Some(err),
                            };
                            println!(
                                "{}",
                                serde_json::to_string(&resp)
                                    .expect("serializing fuzzy_replace error response")
                            );
                            std::process::exit(1);
                        }
                    }
                }
                Err(e) => {
                    let resp = fuzzy_replace::FuzzyReplaceResponse {
                        success: false,
                        result: None,
                        strategy: None,
                        matches_count: 0,
                        error: Some(format!("Failed to parse request JSON: {}", e)),
                    };
                    println!(
                        "{}",
                        serde_json::to_string(&resp).expect("serializing error response")
                    );
                    std::process::exit(1);
                }
            }
        }
        "code-graph" => {
            let mut root_dir = None;
            let mut max_files = None;

            let mut idx = 2;
            while idx < args.len() {
                if args[idx] == "--root" && idx + 1 < args.len() {
                    root_dir = Some(PathBuf::from(&args[idx + 1]));
                    idx += 2;
                } else if args[idx] == "--max-files" && idx + 1 < args.len() {
                    max_files = args[idx + 1].parse::<usize>().ok();
                    idx += 2;
                } else {
                    if root_dir.is_none() && !args[idx].starts_with('-') {
                        root_dir = Some(PathBuf::from(&args[idx]));
                    }
                    idx += 1;
                }
            }

            let final_root = root_dir.unwrap_or_else(|| {
                let mut input = String::new();
                if io::stdin().read_to_string(&mut input).is_ok() && !input.trim().is_empty() {
                    if let Ok(req) = serde_json::from_str::<code_graph::ExtractGraphRequest>(&input)
                    {
                        if req.max_files.is_some() {
                            max_files = req.max_files;
                        }
                        return PathBuf::from(req.root_dir);
                    }
                }
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            });

            let graph = code_graph::extract_code_graph(&final_root, max_files);
            println!(
                "{}",
                serde_json::to_string(&graph).expect("serializing code graph result")
            );
        }
        "scrub" => {
            let mut input = String::new();
            if let Err(e) = io::stdin().read_to_string(&mut input) {
                eprintln!("Failed to read stdin: {}", e);
                std::process::exit(1);
            }
            let scrubbed = sanitizer::redact_secrets(&input);
            print!("{}", scrubbed);
        }
        "inspect-command" => {
            let cmd_str = if args.len() >= 3 {
                args[2..].join(" ")
            } else {
                let mut input = String::new();
                if let Err(e) = io::stdin().read_to_string(&mut input) {
                    eprintln!("Failed to read stdin: {}", e);
                    std::process::exit(1);
                }
                input
            };
            let result = sanitizer::analyze_command_safety(&cmd_str);
            println!(
                "{}",
                serde_json::to_string(&result).expect("serializing command safety result")
            );
        }
        "line-count" => {
            if args.len() < 3 {
                eprintln!("Usage: navi-native line-count <file-path>");
                std::process::exit(1);
            }
            let path = PathBuf::from(&args[2]);
            match std::fs::File::open(&path) {
                Ok(file) => {
                    use std::io::BufRead;
                    let reader = io::BufReader::new(file);
                    let count = reader.lines().count();
                    println!("{}", count);
                }
                Err(e) => {
                    eprintln!("Failed to open file: {}", e);
                    std::process::exit(1);
                }
            }
        }
        "structure" => {
            let target_dir = if args.len() >= 3 && !args[2].starts_with("--") {
                PathBuf::from(&args[2])
            } else {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            };

            let as_json = args.iter().any(|a| a == "--json");
            let include_tests = args.iter().any(|a| a == "--include-tests");

            let res = structure::scan_directory(&target_dir, include_tests);
            if as_json {
                println!(
                    "{}",
                    serde_json::to_string(&res).expect("serializing structure scan result")
                );
            } else {
                print!("{}", structure::render_dense_text(&res));
            }
        }
        "bpe-tokens" => {
            let input = if args.len() >= 3 && args[2] != "--stdin" {
                args[2].clone()
            } else {
                let mut buf = String::new();
                if let Err(e) = io::stdin().read_to_string(&mut buf) {
                    eprintln!("Failed to read stdin: {}", e);
                    std::process::exit(1);
                }
                buf
            };
            let count = compactor::count_tokens(&input);
            println!("{}", count);
        }
        "compact" => {
            let max_tokens = if args.len() >= 3 {
                match args[2].parse::<usize>() {
                    Ok(n) => n,
                    Err(_) => {
                        eprintln!(
                            "Error: invalid max-tokens argument '{}'. Usage: navi-native compact <max-tokens>",
                            args[2]
                        );
                        std::process::exit(1);
                    }
                }
            } else {
                8000
            };

            let mut input = String::new();
            if let Err(e) = io::stdin().read_to_string(&mut input) {
                eprintln!("Failed to read stdin: {}", e);
                std::process::exit(1);
            }

            match serde_json::from_str::<compactor::CompactRequest>(&input) {
                Ok(mut req) => {
                    if req.max_tokens == 0 {
                        req.max_tokens = max_tokens;
                    }
                    let res = compactor::compact_messages(&req);
                    println!(
                        "{}",
                        serde_json::to_string(&res).expect("serializing compact result")
                    );
                }
                Err(err) => {
                    eprintln!("Failed to parse CompactRequest JSON: {}", err);
                    std::process::exit(1);
                }
            }
        }
        "inspect-binary" => {
            if args.len() < 3 {
                eprintln!("Usage: navi-native inspect-binary <file-path>");
                std::process::exit(1);
            }
            let path = PathBuf::from(&args[2]);
            match binary_inspect::inspect_binary(&path) {
                Ok(res) => {
                    println!(
                        "{}",
                        serde_json::to_string(&res).expect("serializing binary inspection result")
                    );
                }
                Err(e) => {
                    eprintln!("Binary inspection error: {}", e);
                    std::process::exit(1);
                }
            }
        }
        cmd => {
            eprintln!("Unknown command: {}", cmd);
            std::process::exit(1);
        }
    }
}
