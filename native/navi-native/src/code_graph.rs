use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeNode {
    pub id: String,
    pub label: String,
    pub source_file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_location: Option<String>,
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub community: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degree: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeEdge {
    pub source: String,
    pub target: String,
    pub relation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodeGraphData {
    pub nodes: Vec<CodeNode>,
    pub edges: Vec<CodeEdge>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractGraphRequest {
    pub root_dir: String,
    #[serde(default)]
    pub max_files: Option<usize>,
}

const NOISE_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "target",
    ".turbo",
    ".opencode",
    ".navi",
    ".gemini",
    "build",
    "coverage",
    ".cache",
    "graphify-out",
    "scratch",
    "scratch_agency_agents",
    "scratch_cf_sec",
    "scratch_graphify",
    ".idea",
    ".vscode",
];

fn should_skip_dir(name: &str) -> bool {
    NOISE_DIRS.contains(&name) || name.starts_with('.')
}

fn is_supported_source_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    matches!(
        ext,
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "rs" | "py" | "go" | "json"
    )
}

/// Strips comments (block comments, line comments, docstrings) while preserving string literals.
pub fn strip_comments(content: &str, ext: &str) -> String {
    let mut chars: Vec<char> = content.chars().collect();
    let len = chars.len();
    let mut i = 0;

    let is_python = ext == "py";

    while i < len {
        // 1. Python triple-quoted docstrings (""" or ''')
        if is_python && i + 2 < len {
            if chars[i] == '"' && chars[i + 1] == '"' && chars[i + 2] == '"' {
                chars[i] = ' ';
                chars[i + 1] = ' ';
                chars[i + 2] = ' ';
                i += 3;
                while i + 2 < len
                    && !(chars[i] == '"' && chars[i + 1] == '"' && chars[i + 2] == '"')
                {
                    if chars[i] != '\n' && chars[i] != '\r' {
                        chars[i] = ' ';
                    }
                    i += 1;
                }
                if i + 2 < len {
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    chars[i + 2] = ' ';
                    i += 3;
                }
                continue;
            } else if chars[i] == '\'' && chars[i + 1] == '\'' && chars[i + 2] == '\'' {
                chars[i] = ' ';
                chars[i + 1] = ' ';
                chars[i + 2] = ' ';
                i += 3;
                while i + 2 < len
                    && !(chars[i] == '\'' && chars[i + 1] == '\'' && chars[i + 2] == '\'')
                {
                    if chars[i] != '\n' && chars[i] != '\r' {
                        chars[i] = ' ';
                    }
                    i += 1;
                }
                if i + 2 < len {
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    chars[i + 2] = ' ';
                    i += 3;
                }
                continue;
            }
        }

        // 2. Skip string literals without modifying them
        if chars[i] == '"' || chars[i] == '\'' || (!is_python && chars[i] == '`') {
            let quote = chars[i];
            i += 1;
            while i < len && chars[i] != quote {
                if chars[i] == '\\' && i + 1 < len {
                    i += 2;
                } else {
                    i += 1;
                }
            }
            if i < len && chars[i] == quote {
                i += 1;
            }
            continue;
        }

        // 3. Multi-line block comments /* ... */
        if !is_python && i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
            chars[i] = ' ';
            chars[i + 1] = ' ';
            i += 2;
            let mut depth = 1;
            while i < len && depth > 0 {
                if ext == "rs" && i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
                    depth += 1;
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    i += 2;
                    continue;
                }
                if i + 1 < len && chars[i] == '*' && chars[i + 1] == '/' {
                    depth -= 1;
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    i += 2;
                    continue;
                }
                if chars[i] != '\n' && chars[i] != '\r' {
                    chars[i] = ' ';
                }
                i += 1;
            }
            continue;
        }

        // 3. Single-line comments // ... or # ...
        if (!is_python && i + 1 < len && chars[i] == '/' && chars[i + 1] == '/')
            || (is_python && chars[i] == '#')
        {
            while i < len && chars[i] != '\n' {
                chars[i] = ' ';
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    chars.into_iter().collect()
}

/// Masks string literals with whitespace, preserving character offsets.
pub fn mask_strings(content: &str, ext: &str) -> String {
    let mut chars: Vec<char> = content.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let is_python = ext == "py";

    while i < len {
        if chars[i] == '"' || chars[i] == '\'' || (!is_python && chars[i] == '`') {
            let quote = chars[i];
            i += 1;
            while i < len && chars[i] != quote {
                if chars[i] == '\\' && i + 1 < len {
                    if chars[i] != '\n' && chars[i] != '\r' {
                        chars[i] = ' ';
                    }
                    if chars[i + 1] != '\n' && chars[i + 1] != '\r' {
                        chars[i + 1] = ' ';
                    }
                    i += 2;
                    continue;
                }
                if chars[i] != '\n' && chars[i] != '\r' {
                    chars[i] = ' ';
                }
                i += 1;
            }
            if i < len && chars[i] == quote {
                i += 1;
            }
            continue;
        }
        i += 1;
    }

    chars.into_iter().collect()
}

pub struct CodeGraphExtractor {
    ts_import_re: Regex,
    ts_class_re: Regex,
    ts_iface_re: Regex,
    ts_type_re: Regex,
    ts_fn_re: Regex,

    rs_use_re: Regex,
    rs_struct_re: Regex,
    rs_enum_re: Regex,
    rs_trait_re: Regex,
    rs_impl_re: Regex,
    rs_fn_re: Regex,

    py_import_re: Regex,
    py_from_import_re: Regex,
    py_class_re: Regex,
    py_def_re: Regex,

    go_import_single_re: Regex,
    go_type_re: Regex,
    go_func_re: Regex,
}

impl CodeGraphExtractor {
    pub fn new() -> Self {
        Self {
            ts_import_re: Regex::new(
                r#"(?s)(?:import\s+(?:type\s+)?(?:[\w*\s{},$]+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))"#,
            )
            .expect("valid ts_import_re"),
            ts_class_re: Regex::new(
                r#"(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$]+))?(?:\s+implements\s+([A-Za-z0-9_$,\s]+))?"#,
            )
            .expect("valid ts_class_re"),
            ts_iface_re: Regex::new(
                r#"(?:export\s+)?interface\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$,\s]+))?"#,
            )
            .expect("valid ts_iface_re"),
            ts_type_re: Regex::new(r#"(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*="#)
                .expect("valid ts_type_re"),
            ts_fn_re: Regex::new(
                r#"(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>"#,
            )
            .expect("valid ts_fn_re"),

            rs_use_re: Regex::new(r#"use\s+([a-zA-Z0-9_:]+)(?:::\{[^}]+\})?;"#)
                .expect("valid rs_use_re"),
            rs_struct_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?struct\s+([A-Za-z0-9_]+)"#)
                .expect("valid rs_struct_re"),
            rs_enum_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?enum\s+([A-Za-z0-9_]+)"#)
                .expect("valid rs_enum_re"),
            rs_trait_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?trait\s+([A-Za-z0-9_]+)"#)
                .expect("valid rs_trait_re"),
            rs_impl_re: Regex::new(r#"impl(?:<[^>]+>)?\s+(?:([A-Za-z0-9_]+)\s+for\s+)?([A-Za-z0-9_]+)"#)
                .expect("valid rs_impl_re"),
            rs_fn_re: Regex::new(r#"(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)"#)
                .expect("valid rs_fn_re"),

            py_import_re: Regex::new(r#"^\s*import\s+([a-zA-Z0-9_.]+)"#)
                .expect("valid py_import_re"),
            py_from_import_re: Regex::new(r#"^\s*from\s+([a-zA-Z0-9_.]+)\s+import"#)
                .expect("valid py_from_import_re"),
            py_class_re: Regex::new(r#"^\s*class\s+([A-Za-z0-9_]+)(?:\(([^)]+)\))?:"#)
                .expect("valid py_class_re"),
            py_def_re: Regex::new(r#"^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\("#)
                .expect("valid py_def_re"),

            go_import_single_re: Regex::new(r#"import\s+(?:\w+\s+)?["']([^"']+)["']"#)
                .expect("valid go_import_single_re"),
            go_type_re: Regex::new(r#"type\s+([A-Za-z0-9_]+)\s+(struct|interface)"#)
                .expect("valid go_type_re"),
            go_func_re: Regex::new(r#"func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\("#)
                .expect("valid go_func_re"),
        }
    }

    pub fn extract_file(
        &self,
        rel_path: &str,
        raw_content: &str,
        known_files: &HashSet<String>,
    ) -> (Vec<CodeNode>, Vec<CodeEdge>) {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();

        let file_name = Path::new(rel_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(rel_path);

        // Register File Node
        nodes.push(CodeNode {
            id: rel_path.to_string(),
            label: file_name.to_string(),
            source_file: rel_path.to_string(),
            source_location: Some("L1".to_string()),
            node_type: "file".to_string(),
            community: None,
            degree: None,
        });

        let ext = Path::new(rel_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        if file_name == "package.json" {
            self.extract_package_json(rel_path, raw_content, &mut edges);
            return (nodes, edges);
        }

        // False-Positive Defense:
        // 1. Strip comments so comment text never creates imports or symbols.
        let import_content = strip_comments(raw_content, ext);
        // 2. Mask string literals so strings like 'class Foo {}' never create fake symbols.
        let defs_content = mask_strings(&import_content, ext);

        match ext {
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => {
                self.extract_js_ts(
                    rel_path,
                    &import_content,
                    &defs_content,
                    known_files,
                    &mut nodes,
                    &mut edges,
                );
            }
            "rs" => {
                self.extract_rust(
                    rel_path,
                    &import_content,
                    &defs_content,
                    &mut nodes,
                    &mut edges,
                );
            }
            "py" => {
                self.extract_python(
                    rel_path,
                    &import_content,
                    &defs_content,
                    &mut nodes,
                    &mut edges,
                );
            }
            "go" => {
                self.extract_go(
                    rel_path,
                    &import_content,
                    &defs_content,
                    &mut nodes,
                    &mut edges,
                );
            }
            _ => {}
        }

        (nodes, edges)
    }

    fn extract_js_ts(
        &self,
        rel_path: &str,
        import_content: &str,
        defs_content: &str,
        known_files: &HashSet<String>,
        nodes: &mut Vec<CodeNode>,
        edges: &mut Vec<CodeEdge>,
    ) {
        // 1. Imports
        for caps in self.ts_import_re.captures_iter(import_content) {
            let target = caps
                .get(1)
                .or_else(|| caps.get(2))
                .or_else(|| caps.get(3))
                .map(|m| m.as_str());

            if let Some(import_target) = target {
                if !import_target.starts_with("node:") {
                    let mut resolved_target = import_target.to_string();
                    if import_target.starts_with('.') {
                        let file_dir = Path::new(rel_path)
                            .parent()
                            .unwrap_or_else(|| Path::new(""));
                        let joined = file_dir.join(import_target);
                        let normalized = normalize_path_str(&joined);

                        resolved_target = normalized.clone();
                        for candidate_ext in
                            &[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"]
                        {
                            let test_path = format!("{}{}", normalized, candidate_ext);
                            if known_files.contains(&test_path) {
                                resolved_target = test_path;
                                break;
                            }
                        }
                    }

                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: resolved_target,
                        relation: "imports".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            }
        }

        // 2. Classes
        for caps in self.ts_class_re.captures_iter(defs_content) {
            if let Some(class_match) = caps.get(1) {
                let class_name = class_match.as_str();
                let class_id = format!("{}::{}", rel_path, class_name);

                nodes.push(CodeNode {
                    id: class_id.clone(),
                    label: class_name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "class".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: class_id.clone(),
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });

                if let Some(ext_match) = caps.get(2) {
                    let extends_name = ext_match.as_str();
                    edges.push(CodeEdge {
                        source: class_id.clone(),
                        target: extends_name.to_string(),
                        relation: "extends".to_string(),
                        confidence: Some("INFERRED".to_string()),
                    });
                }

                if let Some(impl_match) = caps.get(3) {
                    for impl_item in impl_match.as_str().split(',') {
                        let trimmed = impl_item.trim();
                        if !trimmed.is_empty() {
                            edges.push(CodeEdge {
                                source: class_id.clone(),
                                target: trimmed.to_string(),
                                relation: "implements".to_string(),
                                confidence: Some("INFERRED".to_string()),
                            });
                        }
                    }
                }
            }
        }

        // 3. Interfaces
        for caps in self.ts_iface_re.captures_iter(defs_content) {
            if let Some(iface_match) = caps.get(1) {
                let iface_name = iface_match.as_str();
                let iface_id = format!("{}::{}", rel_path, iface_name);

                nodes.push(CodeNode {
                    id: iface_id.clone(),
                    label: iface_name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "interface".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: iface_id.clone(),
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });

                if let Some(ext_match) = caps.get(2) {
                    for ext_item in ext_match.as_str().split(',') {
                        let trimmed = ext_item.trim();
                        if !trimmed.is_empty() {
                            edges.push(CodeEdge {
                                source: iface_id.clone(),
                                target: trimmed.to_string(),
                                relation: "extends".to_string(),
                                confidence: Some("INFERRED".to_string()),
                            });
                        }
                    }
                }
            }
        }

        // 4. Types
        for caps in self.ts_type_re.captures_iter(defs_content) {
            if let Some(type_match) = caps.get(1) {
                let type_name = type_match.as_str();
                let type_id = format!("{}::{}", rel_path, type_name);

                nodes.push(CodeNode {
                    id: type_id.clone(),
                    label: type_name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "type".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: type_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        // 5. Functions
        for caps in self.ts_fn_re.captures_iter(defs_content) {
            let fn_name_opt = caps.get(1).or_else(|| caps.get(2)).map(|m| m.as_str());
            if let Some(fn_name) = fn_name_opt {
                if !["if", "for", "while", "switch", "catch"].contains(&fn_name) {
                    let fn_id = format!("{}::{}", rel_path, fn_name);

                    nodes.push(CodeNode {
                        id: fn_id.clone(),
                        label: format!("{}()", fn_name),
                        source_file: rel_path.to_string(),
                        source_location: None,
                        node_type: "function".to_string(),
                        community: None,
                        degree: None,
                    });

                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: fn_id,
                        relation: "defines".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            }
        }
    }

    fn extract_rust(
        &self,
        rel_path: &str,
        import_content: &str,
        defs_content: &str,
        nodes: &mut Vec<CodeNode>,
        edges: &mut Vec<CodeEdge>,
    ) {
        // 1. Imports: use ...;
        for caps in self.rs_use_re.captures_iter(import_content) {
            if let Some(use_match) = caps.get(1) {
                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: use_match.as_str().to_string(),
                    relation: "imports".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        // 2. Structs
        for caps in self.rs_struct_re.captures_iter(defs_content) {
            if let Some(m) = caps.get(1) {
                let name = m.as_str();
                let def_id = format!("{}::{}", rel_path, name);

                nodes.push(CodeNode {
                    id: def_id.clone(),
                    label: name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "class".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: def_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        // 3. Enums
        for caps in self.rs_enum_re.captures_iter(defs_content) {
            if let Some(m) = caps.get(1) {
                let name = m.as_str();
                let def_id = format!("{}::{}", rel_path, name);

                nodes.push(CodeNode {
                    id: def_id.clone(),
                    label: name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "class".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: def_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        // 4. Traits
        for caps in self.rs_trait_re.captures_iter(defs_content) {
            if let Some(m) = caps.get(1) {
                let name = m.as_str();
                let def_id = format!("{}::{}", rel_path, name);

                nodes.push(CodeNode {
                    id: def_id.clone(),
                    label: name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "interface".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: def_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        // 5. Impls
        for caps in self.rs_impl_re.captures_iter(defs_content) {
            if let Some(trait_match) = caps.get(1) {
                if let Some(target_match) = caps.get(2) {
                    edges.push(CodeEdge {
                        source: format!("{}::{}", rel_path, target_match.as_str()),
                        target: trait_match.as_str().to_string(),
                        relation: "implements".to_string(),
                        confidence: Some("INFERRED".to_string()),
                    });
                }
            }
        }

        // 6. Functions
        for caps in self.rs_fn_re.captures_iter(defs_content) {
            if let Some(m) = caps.get(1) {
                let fn_name = m.as_str();
                let fn_id = format!("{}::{}", rel_path, fn_name);

                nodes.push(CodeNode {
                    id: fn_id.clone(),
                    label: format!("{}()", fn_name),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "function".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: fn_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }
    }

    fn extract_python(
        &self,
        rel_path: &str,
        import_content: &str,
        defs_content: &str,
        nodes: &mut Vec<CodeNode>,
        edges: &mut Vec<CodeEdge>,
    ) {
        for line in import_content.lines() {
            if let Some(caps) = self.py_import_re.captures(line) {
                if let Some(m) = caps.get(1) {
                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: m.as_str().to_string(),
                        relation: "imports".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            } else if let Some(caps) = self.py_from_import_re.captures(line) {
                if let Some(m) = caps.get(1) {
                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: m.as_str().to_string(),
                        relation: "imports".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            }
        }

        for line in defs_content.lines() {
            if let Some(caps) = self.py_class_re.captures(line) {
                if let Some(m) = caps.get(1) {
                    let class_name = m.as_str();
                    let class_id = format!("{}::{}", rel_path, class_name);

                    nodes.push(CodeNode {
                        id: class_id.clone(),
                        label: class_name.to_string(),
                        source_file: rel_path.to_string(),
                        source_location: None,
                        node_type: "class".to_string(),
                        community: None,
                        degree: None,
                    });

                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: class_id.clone(),
                        relation: "defines".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });

                    if let Some(base_match) = caps.get(2) {
                        let base_name = base_match.as_str().trim();
                        if !base_name.is_empty() {
                            edges.push(CodeEdge {
                                source: class_id,
                                target: base_name.to_string(),
                                relation: "extends".to_string(),
                                confidence: Some("INFERRED".to_string()),
                            });
                        }
                    }
                }
            } else if let Some(caps) = self.py_def_re.captures(line) {
                if let Some(m) = caps.get(1) {
                    let fn_name = m.as_str();
                    let fn_id = format!("{}::{}", rel_path, fn_name);

                    nodes.push(CodeNode {
                        id: fn_id.clone(),
                        label: format!("{}()", fn_name),
                        source_file: rel_path.to_string(),
                        source_location: None,
                        node_type: "function".to_string(),
                        community: None,
                        degree: None,
                    });

                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: fn_id,
                        relation: "defines".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            }
        }
    }

    fn extract_go(
        &self,
        rel_path: &str,
        import_content: &str,
        defs_content: &str,
        nodes: &mut Vec<CodeNode>,
        edges: &mut Vec<CodeEdge>,
    ) {
        for caps in self.go_import_single_re.captures_iter(import_content) {
            if let Some(m) = caps.get(1) {
                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: m.as_str().to_string(),
                    relation: "imports".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        for caps in self.go_type_re.captures_iter(defs_content) {
            if let Some(name_m) = caps.get(1) {
                let kind_m = caps.get(2).map(|k| k.as_str()).unwrap_or("struct");
                let name = name_m.as_str();
                let def_id = format!("{}::{}", rel_path, name);
                let node_type = if kind_m == "interface" {
                    "interface"
                } else {
                    "class"
                };

                nodes.push(CodeNode {
                    id: def_id.clone(),
                    label: name.to_string(),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: node_type.to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: def_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }

        for caps in self.go_func_re.captures_iter(defs_content) {
            if let Some(m) = caps.get(1) {
                let fn_name = m.as_str();
                let fn_id = format!("{}::{}", rel_path, fn_name);

                nodes.push(CodeNode {
                    id: fn_id.clone(),
                    label: format!("{}()", fn_name),
                    source_file: rel_path.to_string(),
                    source_location: None,
                    node_type: "function".to_string(),
                    community: None,
                    degree: None,
                });

                edges.push(CodeEdge {
                    source: rel_path.to_string(),
                    target: fn_id,
                    relation: "defines".to_string(),
                    confidence: Some("EXTRACTED".to_string()),
                });
            }
        }
    }

    fn extract_package_json(&self, rel_path: &str, content: &str, edges: &mut Vec<CodeEdge>) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
            if let Some(deps) = val.get("dependencies").and_then(|d| d.as_object()) {
                for dep_name in deps.keys() {
                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: dep_name.clone(),
                        relation: "imports".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            }
            if let Some(dev_deps) = val.get("devDependencies").and_then(|d| d.as_object()) {
                for dep_name in dev_deps.keys() {
                    edges.push(CodeEdge {
                        source: rel_path.to_string(),
                        target: dep_name.clone(),
                        relation: "imports".to_string(),
                        confidence: Some("EXTRACTED".to_string()),
                    });
                }
            }
        }
    }
}

impl Default for CodeGraphExtractor {
    fn default() -> Self {
        Self::new()
    }
}

fn normalize_path_str(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for seg in s.split('/') {
        if seg == "." || seg.is_empty() {
            continue;
        } else if seg == ".." {
            parts.pop();
        } else {
            parts.push(seg);
        }
    }
    parts.join("/")
}

fn collect_files_recursive(dir: &Path, files: &mut Vec<PathBuf>, max_files: usize) {
    if files.len() >= max_files {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        if files.len() >= max_files {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if !should_skip_dir(&name_str) {
                collect_files_recursive(&path, files, max_files);
            }
        } else if path.is_file() && is_supported_source_file(&path) {
            files.push(path);
        }
    }
}

/// High-performance multi-language code graph extractor parallelized with Rayon.
pub fn extract_code_graph(root_dir: &Path, max_files: Option<usize>) -> CodeGraphData {
    let max = max_files.unwrap_or(2000);
    let mut file_paths = Vec::new();
    collect_files_recursive(root_dir, &mut file_paths, max);

    let known_files: HashSet<String> = file_paths
        .iter()
        .filter_map(|p| p.strip_prefix(root_dir).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .collect();

    let extractor = CodeGraphExtractor::new();

    // Parallel file processing with Rayon work-stealing threadpool
    let results: Vec<(Vec<CodeNode>, Vec<CodeEdge>)> = file_paths
        .par_iter()
        .filter_map(|path| {
            let rel = path.strip_prefix(root_dir).ok()?;
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let content = fs::read_to_string(path).ok()?;
            Some(extractor.extract_file(&rel_str, &content, &known_files))
        })
        .collect();

    let mut total_nodes = Vec::new();
    let mut total_edges = Vec::new();

    for (nodes, edges) in results {
        total_nodes.extend(nodes);
        total_edges.extend(edges);
    }

    CodeGraphData {
        nodes: total_nodes,
        edges: total_edges,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitizer_removes_multiline_comments_and_strings() {
        let code = r#"
        /*
        export function fakeInComment() {
            return "fake";
        }
        */
        const s = "class FakeInString {}";
        // function fakeInLineComment() {}
        export function realFunction() {
            return 42;
        }
        "#;
        let comment_stripped = strip_comments(code, "ts");
        assert!(!comment_stripped.contains("fakeInComment"));
        assert!(!comment_stripped.contains("fakeInLineComment"));
        let masked = mask_strings(&comment_stripped, "ts");
        assert!(!masked.contains("FakeInString"));
        assert!(masked.contains("realFunction"));
    }

    #[test]
    fn test_sanitizer_python_docstrings() {
        let code = r#"
        """
        def fake_py():
            pass
        """
        # def line_comment(): pass
        def real_py():
            pass
        "#;
        let comment_stripped = strip_comments(code, "py");
        assert!(!comment_stripped.contains("fake_py"));
        assert!(!comment_stripped.contains("line_comment"));
        assert!(comment_stripped.contains("real_py"));
    }

    #[test]
    fn test_ts_multiline_import_and_class_extraction() {
        let code = r#"
        import {
            Alpha,
            Beta as B,
            type Gamma
        } from "./service";

        export class WorkerService extends BaseWorker implements IWorker, IDisposable {
            execute() {}
        }

        export interface IWorker {
            execute(): void;
        }

        export type WorkerStatus = "idle" | "busy";

        export async function startWorker() {}
        "#;
        let extractor = CodeGraphExtractor::new();
        let known = HashSet::from(["service.ts".to_string()]);
        let (nodes, edges) = extractor.extract_file("src/worker.ts", code, &known);

        let labels: Vec<&str> = nodes.iter().map(|n| n.label.as_str()).collect();
        assert!(labels.contains(&"worker.ts"));
        assert!(labels.contains(&"WorkerService"));
        assert!(labels.contains(&"IWorker"));
        assert!(labels.contains(&"WorkerStatus"));
        assert!(labels.contains(&"startWorker()"));

        let relations: Vec<&str> = edges.iter().map(|e| e.relation.as_str()).collect();
        assert!(relations.contains(&"imports"));
        assert!(relations.contains(&"defines"));
        assert!(relations.contains(&"extends"));
        assert!(relations.contains(&"implements"));
    }

    #[test]
    fn test_rust_struct_enum_trait_extraction() {
        let code = r#"
        use crate::config::AppConfig;

        pub struct ServerConfig {
            pub port: u16,
        }

        pub enum Protocol {
            Http,
            Https,
        }

        pub trait Runnable {
            fn run(&self);
        }

        impl Runnable for ServerConfig {
            fn run(&self) {}
        }

        pub async fn init_server() {}
        "#;
        let extractor = CodeGraphExtractor::new();
        let (nodes, edges) = extractor.extract_file("src/server.rs", code, &HashSet::new());

        let labels: Vec<&str> = nodes.iter().map(|n| n.label.as_str()).collect();
        assert!(labels.contains(&"ServerConfig"));
        assert!(labels.contains(&"Protocol"));
        assert!(labels.contains(&"Runnable"));
        assert!(labels.contains(&"init_server()"));

        let implements_edge = edges.iter().find(|e| e.relation == "implements");
        assert!(implements_edge.is_some());
        assert_eq!(implements_edge.unwrap().target, "Runnable");
    }

    #[test]
    fn test_go_and_python_extraction() {
        let go_code = r#"
        package main
        import "net/http"

        type Handler struct {}
        type Router interface {}

        func ListenAndServe() {}
        "#;
        let extractor = CodeGraphExtractor::new();
        let (go_nodes, go_edges) = extractor.extract_file("server.go", go_code, &HashSet::new());
        let go_labels: Vec<&str> = go_nodes.iter().map(|n| n.label.as_str()).collect();
        assert!(go_labels.contains(&"Handler"));
        assert!(go_labels.contains(&"Router"));
        assert!(go_labels.contains(&"ListenAndServe()"));
        assert!(go_edges.iter().any(|e| e.target == "net/http"));

        let py_code = r#"
        from database import get_session
        class UserManager(BaseManager):
            def create_user():
                pass
        "#;
        let (py_nodes, py_edges) = extractor.extract_file("users.py", py_code, &HashSet::new());
        let py_labels: Vec<&str> = py_nodes.iter().map(|n| n.label.as_str()).collect();
        assert!(py_labels.contains(&"UserManager"));
        assert!(py_labels.contains(&"create_user()"));
        assert!(py_edges
            .iter()
            .any(|e| e.relation == "extends" && e.target == "BaseManager"));
    }
}
