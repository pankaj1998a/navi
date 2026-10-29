use std::io::{self, Read};
use std::path::PathBuf;

mod seek_sequence;
mod patch;
mod sanitizer;
mod structure;
mod compactor;
mod binary_inspect;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: navi-native <apply-patch|scrub|line-count|structure|bpe-tokens|compact|inspect-binary> [args...]");
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
                println!("{}", serde_json::to_string(&err_res).expect("serializing patch error result"));
                std::process::exit(1);
            }

            let result = patch::execute_patch(&root_dir, &patch_content);
            println!("{}", serde_json::to_string(&result).expect("serializing patch result"));
            if !result.success {
                std::process::exit(1);
            }
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
                println!("{}", serde_json::to_string(&res).expect("serializing structure scan result"));
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
                    println!("{}", serde_json::to_string(&res).expect("serializing compact result"));
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
                    println!("{}", serde_json::to_string(&res).expect("serializing binary inspection result"));
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
