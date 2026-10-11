use std::fs;
use std::path::Path;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolEntry {
    pub kind: String,
    pub name: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStructure {
    pub path: String,
    pub lines: usize,
    pub symbols: Vec<SymbolEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructureResult {
    pub root: String,
    pub total_files: usize,
    pub total_lines: usize,
    pub total_symbols: usize,
    pub files: Vec<FileStructure>,
}

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    ".turbo",
    "vendor",
    "coverage",
    ".idea",
    ".vscode",
];

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name) || name.starts_with('.')
}

fn is_supported_source_file(path: &Path) -> bool {
    match path.extension().and_then(|s| s.to_str()) {
        Some("ts") | Some("tsx") | Some("js") | Some("jsx") | Some("mjs") | Some("cjs") |
        Some("rs") | Some("py") | Some("go") | Some("swift") => true,
        _ => false,
    }
}

pub struct SymbolExtractor {
    ts_fn_re: Regex,
    ts_class_re: Regex,
    ts_iface_re: Regex,
    ts_type_re: Regex,
    ts_enum_re: Regex,
    
    rs_fn_re: Regex,
    rs_struct_re: Regex,
    rs_enum_re: Regex,
    rs_trait_re: Regex,
    rs_impl_re: Regex,

    py_def_re: Regex,
    py_class_re: Regex,

    go_func_re: Regex,
    go_type_re: Regex,

    swift_func_re: Regex,
    swift_type_re: Regex,
}

impl SymbolExtractor {
    pub fn new() -> Self {
        Self {
            ts_fn_re: Regex::new(r#"(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>"#).unwrap(),
            ts_class_re: Regex::new(r#"(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)"#).unwrap(),
            ts_iface_re: Regex::new(r#"(?:export\s+)?interface\s+([A-Za-z0-9_$]+)"#).unwrap(),
            ts_type_re: Regex::new(r#"(?:export\s+)?type\s+([A-Za-z0-9_$]+)"#).unwrap(),
            ts_enum_re: Regex::new(r#"(?:export\s+)?enum\s+([A-Za-z0-9_$]+)"#).unwrap(),

            rs_fn_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)"#).unwrap(),
            rs_struct_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?struct\s+([A-Za-z0-9_]+)"#).unwrap(),
            rs_enum_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?enum\s+([A-Za-z0-9_]+)"#).unwrap(),
            rs_trait_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?trait\s+([A-Za-z0-9_]+)"#).unwrap(),
            rs_impl_re: Regex::new(r#"impl(?:<[^>]+>)?\s+(?:([A-Za-z0-9_]+)\s+for\s+)?([A-Za-z0-9_]+)"#).unwrap(),

            py_def_re: Regex::new(r#"^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)"#).unwrap(),
            py_class_re: Regex::new(r#"^\s*class\s+([A-Za-z0-9_]+)"#).unwrap(),

            go_func_re: Regex::new(r#"^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)"#).unwrap(),
            go_type_re: Regex::new(r#"^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)"#).unwrap(),

            swift_func_re: Regex::new(r#"(?:public\s+|open\s+|private\s+|internal\s+)?func\s+([A-Za-z0-9_]+)"#).unwrap(),
            swift_type_re: Regex::new(r#"(?:public\s+|open\s+|private\s+|internal\s+)?(?:class|struct|enum|protocol)\s+([A-Za-z0-9_]+)"#).unwrap(),
        }
    }

    pub fn extract_symbols(&self, ext: &str, content: &str) -> Vec<SymbolEntry> {
        let mut symbols = Vec::new();
        for (idx, line) in content.lines().enumerate() {
            let line_num = idx + 1;
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("#") || trimmed.starts_with("/*") || trimmed.starts_with("*") {
                continue;
            }

            match ext {
                "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => {
                    if let Some(caps) = self.ts_fn_re.captures(trimmed) {
                        let name = caps.get(1).or_else(|| caps.get(2)).map(|m| m.as_str());
                        if let Some(n) = name {
                            symbols.push(SymbolEntry { kind: "fn".into(), name: n.into(), line: line_num });
                        }
                    } else if let Some(caps) = self.ts_class_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "class".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.ts_iface_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "interface".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.ts_type_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "type".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.ts_enum_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "enum".into(), name: m.as_str().into(), line: line_num });
                        }
                    }
                }
                "rs" => {
                    if let Some(caps) = self.rs_fn_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "fn".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.rs_struct_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "struct".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.rs_enum_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "enum".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.rs_trait_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "trait".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.rs_impl_re.captures(trimmed) {
                        let target = caps.get(2).or_else(|| caps.get(1)).map(|m| m.as_str());
                        if let Some(n) = target {
                            symbols.push(SymbolEntry { kind: "impl".into(), name: n.into(), line: line_num });
                        }
                    }
                }
                "py" => {
                    if let Some(caps) = self.py_def_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "fn".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.py_class_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "class".into(), name: m.as_str().into(), line: line_num });
                        }
                    }
                }
                "go" => {
                    if let Some(caps) = self.go_func_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "fn".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.go_type_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "type".into(), name: m.as_str().into(), line: line_num });
                        }
                    }
                }
                "swift" => {
                    if let Some(caps) = self.swift_func_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "fn".into(), name: m.as_str().into(), line: line_num });
                        }
                    } else if let Some(caps) = self.swift_type_re.captures(trimmed) {
                        if let Some(m) = caps.get(1) {
                            symbols.push(SymbolEntry { kind: "type".into(), name: m.as_str().into(), line: line_num });
                        }
                    }
                }
                _ => {}
            }
        }
        symbols
    }
}

pub fn scan_directory(root: &Path, include_tests: bool) -> StructureResult {
    let mut files = Vec::new();
    let mut total_lines = 0;
    let mut total_symbols = 0;

    let extractor = SymbolExtractor::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if !should_skip_dir(&file_name) {
                    stack.push(path);
                }
            } else if path.is_file() && is_supported_source_file(&path) {
                if !include_tests && (file_name.contains(".test.") || file_name.contains(".spec.") || file_name.ends_with("_test.go")) {
                    continue;
                }

                if let Ok(content) = fs::read_to_string(&path) {
                    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                    let lines = content.lines().count();
                    let symbols = extractor.extract_symbols(ext, &content);

                    let rel_path = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
                    total_lines += lines;
                    total_symbols += symbols.len();

                    files.push(FileStructure {
                        path: rel_path,
                        lines,
                        symbols,
                    });
                }
            }
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    let total_files = files.len();

    StructureResult {
        root: root.to_string_lossy().replace('\\', "/"),
        total_files,
        total_lines,
        total_symbols,
        files,
    }
}

pub fn render_dense_text(result: &StructureResult) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Project Structure Map: {} ({} files, {} lines, {} symbols)\n\n", 
        result.root, result.total_files, result.total_lines, result.total_symbols));

    for file in &result.files {
        if file.symbols.is_empty() {
            out.push_str(&format!("{} ({}L)\n", file.path, file.lines));
            continue;
        }

        // Group symbols by kind
        let mut by_kind: std::collections::BTreeMap<&str, Vec<&str>> = std::collections::BTreeMap::new();
        for sym in &file.symbols {
            by_kind.entry(&sym.kind).or_default().push(&sym.name);
        }

        let parts: Vec<String> = by_kind
            .iter()
            .map(|(k, names)| format!("{}:{}", k, names.join(",")))
            .collect();

        out.push_str(&format!("{} ({}L): {}\n", file.path, file.lines, parts.join(" ")));
    }

    out
}
