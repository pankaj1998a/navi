use std::io::{self, Read};
use std::path::PathBuf;

mod seek_sequence;
mod patch;
mod sanitizer;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: navi-native <apply-patch|scrub|line-count> [args...]");
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
                println!("{}", serde_json::to_string(&err_res).unwrap());
                std::process::exit(1);
            }

            let result = patch::execute_patch(&root_dir, &patch_content);
            println!("{}", serde_json::to_string(&result).unwrap());
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
        cmd => {
            eprintln!("Unknown command: {}", cmd);
            std::process::exit(1);
        }
    }
}
