//! High-performance native code knowledge graph engine for Navi.
//! Provides fast graph building, cycle detection, God node (hub) analysis,
//! blast-radius impact analysis (affected nodes), shortest architectural path,
//! modularity community detection, and scoped subgraph extraction for AI agents.

use std::collections::{HashMap, HashSet, VecDeque};
use serde::{Deserialize, Serialize};

/// Hard recursion cap for DFS traversals; deeper graph regions are skipped
/// gracefully instead of risking stack exhaustion on malformed graphs.
const MAX_DFS_DEPTH: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeNode {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub source_file: String,
    #[serde(default)]
    pub source_location: Option<String>,
    #[serde(default)]
    pub node_type: String, // "file", "function", "class", "interface", "module"
    #[serde(default)]
    pub community: Option<usize>,
    #[serde(default)]
    pub degree: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeEdge {
    pub source: String,
    pub target: String,
    pub relation: String, // "calls", "imports", "defines", "references", "extends", "implements", "uses"
    #[serde(default = "default_confidence")]
    pub confidence: String, // "EXTRACTED", "INFERRED", "AMBIGUOUS"
}

fn default_confidence() -> String {
    "EXTRACTED".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffectedHit {
    pub node_id: String,
    pub label: String,
    pub source_file: String,
    pub depth: usize,
    pub via_relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathStep {
    pub node_id: String,
    pub label: String,
    pub source_file: String,
    pub relation_to_next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleInfo {
    pub path: Vec<String>,
    pub length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphAnalysisResult {
    pub total_nodes: usize,
    pub total_edges: usize,
    pub god_nodes: Vec<CodeNode>,
    pub cycles: Vec<CycleInfo>,
    pub communities: HashMap<usize, Vec<String>>,
    pub surprising_connections: Vec<CodeEdge>,
}

/// In-memory graph structure optimized for fast traversal
#[derive(Debug, Clone)]
pub struct CodeGraph {
    pub nodes: HashMap<String, CodeNode>,
    pub forward_adj: HashMap<String, Vec<(String, String, String)>>, // source -> (target, relation, confidence)
    pub reverse_adj: HashMap<String, Vec<(String, String, String)>>, // target -> (source, relation, confidence)
}

impl CodeGraph {
    pub fn from_nodes_and_edges(nodes_vec: Vec<CodeNode>, edges_vec: Vec<CodeEdge>) -> Self {
        let mut nodes = HashMap::new();
        let mut forward_adj: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
        let mut reverse_adj: HashMap<String, Vec<(String, String, String)>> = HashMap::new();

        for node in nodes_vec {
            nodes.insert(node.id.clone(), node);
        }

        for edge in edges_vec {
            // Ensure nodes exist even if only referenced in edge
            nodes.entry(edge.source.clone()).or_insert_with(|| CodeNode {
                id: edge.source.clone(),
                label: edge.source.clone(),
                source_file: String::new(),
                source_location: None,
                node_type: "unknown".to_string(),
                community: None,
                degree: 0,
            });
            nodes.entry(edge.target.clone()).or_insert_with(|| CodeNode {
                id: edge.target.clone(),
                label: edge.target.clone(),
                source_file: String::new(),
                source_location: None,
                node_type: "unknown".to_string(),
                community: None,
                degree: 0,
            });

            forward_adj
                .entry(edge.source.clone())
                .or_default()
                .push((edge.target.clone(), edge.relation.clone(), edge.confidence.clone()));

            reverse_adj
                .entry(edge.target.clone())
                .or_default()
                .push((edge.source.clone(), edge.relation.clone(), edge.confidence.clone()));
        }

        // Calculate degrees
        for (id, node) in nodes.iter_mut() {
            let out_deg = forward_adj.get(id).map_or(0, |v| v.len());
            let in_deg = reverse_adj.get(id).map_or(0, |v| v.len());
            node.degree = out_deg + in_deg;
        }

        Self {
            nodes,
            forward_adj,
            reverse_adj,
        }
    }

    /// Identify God Nodes: top connected real architectural entities
    pub fn find_god_nodes(&self, top_n: usize) -> Vec<CodeNode> {
        static NOISE_LABELS: &[&str] = &[
            "str", "string", "int", "number", "boolean", "bool", "any", "void", "null", "undefined",
            "object", "true", "false", "path", "fs", "os", "sys", "re", "json", "io",
        ];

        let mut candidates: Vec<CodeNode> = self
            .nodes
            .values()
            .filter(|n| {
                let lower = n.label.to_lowercase();
                if NOISE_LABELS.contains(&lower.as_str()) {
                    return false;
                }
                // Exclude synthetic function stubs with 0 or 1 connection
                if n.degree <= 1 {
                    return false;
                }
                true
            })
            .cloned()
            .collect();

        candidates.sort_by(|a, b| b.degree.cmp(&a.degree));
        candidates.truncate(top_n);
        candidates
    }

    /// Detect circular dependencies using DFS with recursion stack
    pub fn find_cycles(&self, max_cycles: usize) -> Vec<CycleInfo> {
        let mut cycles = Vec::new();
        let mut visited = HashSet::new();
        let mut in_stack = HashSet::new();
        let mut path = Vec::new();

        let mut node_ids: Vec<String> = self.nodes.keys().cloned().collect();
        node_ids.sort();

        for node_id in &node_ids {
            if !visited.contains(node_id) {
                self.dfs_cycle(
                    node_id,
                    &mut visited,
                    &mut in_stack,
                    &mut path,
                    &mut cycles,
                    max_cycles,
                    0,
                );
                if cycles.len() >= max_cycles {
                    break;
                }
            }
        }

        cycles
    }

    /// Recursion beyond `MAX_DFS_DEPTH` is skipped gracefully: adversarial or
    /// malformed graphs could otherwise exhaust the call stack.
    fn dfs_cycle(
        &self,
        current: &str,
        visited: &mut HashSet<String>,
        in_stack: &mut HashSet<String>,
        path: &mut Vec<String>,
        cycles: &mut Vec<CycleInfo>,
        max_cycles: usize,
        depth: usize,
    ) {
        if cycles.len() >= max_cycles || depth >= MAX_DFS_DEPTH {
            return;
        }

        in_stack.insert(current.to_string());
        path.push(current.to_string());

        if let Some(neighbors) = self.forward_adj.get(current) {
            for (target, _, _) in neighbors {
                if in_stack.contains(target) {
                    if let Some(pos) = path.iter().position(|x| x == target) {
                        let cycle_path: Vec<String> = path[pos..].to_vec();
                        let length = cycle_path.len();
                        if !cycles.iter().any(|c| c.path == cycle_path) {
                            cycles.push(CycleInfo {
                                path: cycle_path,
                                length,
                            });
                            if cycles.len() >= max_cycles {
                                return;
                            }
                        }
                    }
                } else if !visited.contains(target) {
                    self.dfs_cycle(target, visited, in_stack, path, cycles, max_cycles, depth + 1);
                    if cycles.len() >= max_cycles {
                        return;
                    }
                }
            }
        }

        path.pop();
        in_stack.remove(current);
        visited.insert(current.to_string());
    }

    /// Blast-Radius Impact Traversal: finds everything affected by a change to `seed`
    pub fn affected_nodes(
        &self,
        seed: &str,
        max_depth: usize,
        allowed_relations: Option<&[&str]>,
    ) -> Vec<AffectedHit> {
        let relations: HashSet<&str> = allowed_relations.map_or_else(
            || {
                [
                    "calls", "imports", "references", "uses", "defines", "implements", "extends",
                ]
                .iter()
                .copied()
                .collect()
            },
            |r| r.iter().copied().collect(),
        );

        let mut hits = Vec::new();
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();

        // Resolve seed: check exact id, label match, or source file match
        let seed_id = self.resolve_seed(seed).unwrap_or_else(|| seed.to_string());
        visited.insert(seed_id.clone());
        queue.push_back((seed_id.clone(), 0, "root".to_string()));

        // Also seed outward member hops for classes/files
        if let Some(forward) = self.forward_adj.get(&seed_id) {
            for (target, relation, _) in forward {
                if relation == "defines" || relation == "contains" {
                    if !visited.contains(target) {
                        visited.insert(target.clone());
                        queue.push_back((target.clone(), 0, relation.clone()));
                    }
                }
            }
        }

        while let Some((curr_id, curr_depth, _)) = queue.pop_front() {
            if curr_depth >= max_depth {
                continue;
            }

            // In blast radius, we follow INCOMING edges (who depends on curr_id)
            if let Some(incoming) = self.reverse_adj.get(&curr_id) {
                for (source, relation, _) in incoming {
                    if !relations.contains(relation.as_str()) {
                        continue;
                    }
                    if !visited.contains(source) {
                        visited.insert(source.clone());
                        let next_depth = curr_depth + 1;

                        let node_label = self
                            .nodes
                            .get(source)
                            .map_or_else(|| source.clone(), |n| n.label.clone());
                        let source_file = self
                            .nodes
                            .get(source)
                            .map_or_else(String::new, |n| n.source_file.clone());

                        hits.push(AffectedHit {
                            node_id: source.clone(),
                            label: node_label,
                            source_file,
                            depth: next_depth,
                            via_relation: relation.clone(),
                        });

                        queue.push_back((source.clone(), next_depth, relation.clone()));
                    }
                }
            }
        }

        hits.sort_by(|a, b| a.depth.cmp(&b.depth));
        hits
    }

    /// Resolve a query string to a node ID
    pub fn resolve_seed(&self, query: &str) -> Option<String> {
        let q_clean = query.trim().trim_end_matches("()");
        if self.nodes.contains_key(q_clean) {
            return Some(q_clean.to_string());
        }

        // Try exact label match
        let label_matches: Vec<&String> = self
            .nodes
            .iter()
            .filter(|(_, n)| n.label.eq_ignore_ascii_case(q_clean) || n.label.trim_end_matches("()").eq_ignore_ascii_case(q_clean))
            .map(|(k, _)| k)
            .collect();

        if label_matches.len() == 1 {
            return Some(label_matches[0].clone());
        }

        // Try file path suffix match
        let file_matches: Vec<&String> = self
            .nodes
            .iter()
            .filter(|(_, n)| {
                n.source_file.ends_with(q_clean)
                    || n.source_file.replace('\\', "/").ends_with(&q_clean.replace('\\', "/"))
            })
            .map(|(k, _)| k)
            .collect();

        if file_matches.len() == 1 {
            return Some(file_matches[0].clone());
        }

        None
    }

    /// Shortest architectural path between two nodes using bidirectional BFS
    pub fn shortest_path(&self, from_query: &str, to_query: &str) -> Option<Vec<PathStep>> {
        let start = self.resolve_seed(from_query)?;
        let goal = self.resolve_seed(to_query)?;

        if start == goal {
            let n = self.nodes.get(&start)?;
            return Some(vec![PathStep {
                node_id: start,
                label: n.label.clone(),
                source_file: n.source_file.clone(),
                relation_to_next: None,
            }]);
        }

        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();
        let mut parent_map: HashMap<String, (String, String)> = HashMap::new(); // curr -> (prev, relation)

        visited.insert(start.clone());
        queue.push_back(start.clone());

        let mut found = false;
        while let Some(curr) = queue.pop_front() {
            if curr == goal {
                found = true;
                break;
            }

            if let Some(forward) = self.forward_adj.get(&curr) {
                for (next_id, rel, _) in forward {
                    if !visited.contains(next_id) {
                        visited.insert(next_id.clone());
                        parent_map.insert(next_id.clone(), (curr.clone(), rel.clone()));
                        queue.push_back(next_id.clone());
                    }
                }
            }
        }

        if !found {
            return None;
        }

        // Reconstruct path
        let mut path_nodes = Vec::new();
        let mut curr = goal;
        while curr != start {
            let (prev, rel) = parent_map.get(&curr)?.clone();
            path_nodes.push((curr.clone(), rel));
            curr = prev;
        }

        path_nodes.reverse();

        let mut result = Vec::new();
        let start_node = self.nodes.get(&start)?;
        result.push(PathStep {
            node_id: start.clone(),
            label: start_node.label.clone(),
            source_file: start_node.source_file.clone(),
            relation_to_next: path_nodes.first().map(|p| p.1.clone()),
        });

        for i in 0..path_nodes.len() {
            let node_id = &path_nodes[i].0;
            let rel_next = if i + 1 < path_nodes.len() {
                Some(path_nodes[i + 1].1.clone())
            } else {
                None
            };
            if let Some(n) = self.nodes.get(node_id) {
                result.push(PathStep {
                    node_id: node_id.clone(),
                    label: n.label.clone(),
                    source_file: n.source_file.clone(),
                    relation_to_next: rel_next,
                });
            }
        }

        Some(result)
    }

    /// Fast Label Propagation for Community Detection
    pub fn detect_communities(&mut self) -> HashMap<usize, Vec<String>> {
        let mut labels: HashMap<String, usize> = HashMap::new();
        let mut sorted_keys: Vec<String> = self.nodes.keys().cloned().collect();
        sorted_keys.sort();

        for (idx, key) in sorted_keys.iter().enumerate() {
            labels.insert(key.clone(), idx);
        }

        // Run iterations of label propagation
        for _ in 0..5 {
            let mut changed = false;
            for key in &sorted_keys {
                let mut freq: HashMap<usize, usize> = HashMap::new();

                // Check forward and reverse neighbors
                if let Some(forward) = self.forward_adj.get(key) {
                    for (t, _, _) in forward {
                        if let Some(&l) = labels.get(t) {
                            *freq.entry(l).or_default() += 1;
                        }
                    }
                }
                if let Some(reverse) = self.reverse_adj.get(key) {
                    for (s, _, _) in reverse {
                        if let Some(&l) = labels.get(s) {
                            *freq.entry(l).or_default() += 1;
                        }
                    }
                }

                if let Some((&best_label, _)) = freq.iter().max_by_key(|&(_, count)| count) {
                    if labels.get(key) != Some(&best_label) {
                        labels.insert(key.clone(), best_label);
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }

        // Remap to compact community IDs 0..K
        let mut remap: HashMap<usize, usize> = HashMap::new();
        let mut next_cid = 0;
        let mut communities: HashMap<usize, Vec<String>> = HashMap::new();

        for (node_id, old_lbl) in &labels {
            let cid = *remap.entry(*old_lbl).or_insert_with(|| {
                let c = next_cid;
                next_cid += 1;
                c
            });
            if let Some(node) = self.nodes.get_mut(node_id) {
                node.community = Some(cid);
            }
            communities.entry(cid).or_default().push(node_id.clone());
        }

        communities
    }

    /// Detect Surprising Connections (cross-community inter-domain edges)
    pub fn find_surprising_connections(&self, top_n: usize) -> Vec<CodeEdge> {
        let mut results = Vec::new();

        for (source_id, neighbors) in &self.forward_adj {
            let src_comm = self.nodes.get(source_id).and_then(|n| n.community);
            for (target_id, relation, confidence) in neighbors {
                let tgt_comm = self.nodes.get(target_id).and_then(|n| n.community);
                if src_comm.is_some() && tgt_comm.is_some() && src_comm != tgt_comm {
                    results.push(CodeEdge {
                        source: source_id.clone(),
                        target: target_id.clone(),
                        relation: relation.clone(),
                        confidence: confidence.clone(),
                    });
                }
            }
        }

        results.truncate(top_n);
        results
    }

    /// Scoped Subgraph Query for AI Prompt Injection
    pub fn query_subgraph(
        &self,
        question: &str,
        depth: usize,
        token_budget: usize,
    ) -> String {
        let terms: Vec<String> = question
            .split_whitespace()
            .map(|s| s.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
            .filter(|s| s.len() >= 3)
            .collect();

        // Find candidate start nodes
        let mut scored_nodes: Vec<(usize, &CodeNode)> = Vec::new();
        for node in self.nodes.values() {
            let mut score = 0;
            let l_label = node.label.to_lowercase();
            let l_file = node.source_file.to_lowercase();
            for term in &terms {
                if l_label == *term {
                    score += 15;
                } else if l_label.contains(term) {
                    score += 5;
                }
                if l_file.contains(term) {
                    score += 3;
                }
            }
            if score > 0 {
                score += (node.degree).min(10);
                scored_nodes.push((score, node));
            }
        }

        scored_nodes.sort_by(|a, b| b.0.cmp(&a.0));
        let start_nodes: Vec<String> = scored_nodes.iter().take(4).map(|s| s.1.id.clone()).collect();

        if start_nodes.is_empty() {
            return format!("No matching nodes found for question: \"{}\"", question);
        }

        // BFS traversal from start nodes up to depth
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        let mut collected_edges = Vec::new();

        for sn in &start_nodes {
            visited.insert(sn.clone());
            queue.push_back((sn.clone(), 0));
        }

        while let Some((curr, curr_depth)) = queue.pop_front() {
            if curr_depth >= depth {
                continue;
            }

            if let Some(forward) = self.forward_adj.get(&curr) {
                for (target, relation, _) in forward {
                    collected_edges.push((curr.clone(), target.clone(), relation.clone()));
                    if !visited.contains(target) {
                        visited.insert(target.clone());
                        queue.push_back((target.clone(), curr_depth + 1));
                    }
                }
            }
        }

        // Render markdown within token budget (~4 chars per token)
        let max_chars = token_budget * 4;
        let mut out = String::new();
        out.push_str(&format!(
            "### Architectural Context for: \"{}\"\n",
            question
        ));
        out.push_str(&format!(
            "- Traversal: BFS depth={}, {} nodes reachable\n",
            depth,
            visited.len()
        ));
        out.push_str(&format!("- Seeds: {:?}\n\n", start_nodes));

        out.push_str("#### Key Entities:\n");
        for nid in &visited {
            if let Some(n) = self.nodes.get(nid) {
                let loc = n
                    .source_location
                    .as_deref()
                    .unwrap_or("");
                let line = format!(
                    "- `{}` ({}) in `{}:{}` (deg: {})\n",
                    n.label, n.node_type, n.source_file, loc, n.degree
                );
                if out.len() + line.len() > max_chars {
                    out.push_str("... [truncated to fit token budget]\n");
                    return out;
                }
                out.push_str(&line);
            }
        }

        out.push_str("\n#### Relationships:\n");
        for (src, tgt, rel) in &collected_edges {
            let src_label = self.nodes.get(src).map_or(src.as_str(), |n| &n.label);
            let tgt_label = self.nodes.get(tgt).map_or(tgt.as_str(), |n| &n.label);
            let line = format!("- `{}` --[{}]--> `{}`\n", src_label, rel, tgt_label);
            if out.len() + line.len() > max_chars {
                out.push_str("... [truncated to fit token budget]\n");
                return out;
            }
            out.push_str(&line);
        }

        out
    }

    /// Full Graph Analysis
    pub fn analyze(&mut self) -> GraphAnalysisResult {
        let communities = self.detect_communities();
        let god_nodes = self.find_god_nodes(10);
        let cycles = self.find_cycles(15);
        let surprising_connections = self.find_surprising_connections(10);

        let total_edges = self.forward_adj.values().map(|v| v.len()).sum();

        GraphAnalysisResult {
            total_nodes: self.nodes.len(),
            total_edges,
            god_nodes,
            cycles,
            communities,
            surprising_connections,
        }
    }

    /// Generate Markdown GRAPH_REPORT.md
    pub fn generate_report(&mut self, repo_name: &str) -> String {
        let analysis = self.analyze();

        let mut doc = String::new();
        doc.push_str(&format!("# Architecture Knowledge Graph Report: {}\n\n", repo_name));
        doc.push_str("Generated by Navi Graph Engine (Rust Native Acceleration).\n\n");

        doc.push_str("## 1. Executive Metrics\n\n");
        doc.push_str(&format!("- **Total Entities (Nodes):** {}\n", analysis.total_nodes));
        doc.push_str(&format!("- **Total Relationships (Edges)**: {}\n", analysis.total_edges));
        doc.push_str(&format!("- **Identified Communities**: {}\n", analysis.communities.len()));
        doc.push_str(&format!("- **Circular Dependency Cycles**: {}\n\n", analysis.cycles.len()));

        doc.push_str("## 2. God Nodes (Core Architectural Hubs)\n\n");
        doc.push_str("| Entity | Type | Source File | Degree | Community |\n");
        doc.push_str("| :--- | :--- | :--- | :--- | :--- |\n");
        for g in &analysis.god_nodes {
            let comm_str = g.community.map_or("-".to_string(), |c| format!("C{}", c));
            doc.push_str(&format!(
                "| `{}` | {} | `{}` | {} | {} |\n",
                g.label, g.node_type, g.source_file, g.degree, comm_str
            ));
        }
        doc.push_str("\n");

        doc.push_str("## 3. Dependency Cycles & Tightly Coupled Paths\n\n");
        if analysis.cycles.is_empty() {
            doc.push_str("No circular dependency cycles detected across analyzed relations.\n\n");
        } else {
            for (idx, c) in analysis.cycles.iter().enumerate() {
                doc.push_str(&format!("### Cycle {} (Length {})\n", idx + 1, c.length));
                doc.push_str(&format!("`{}`\n\n", c.path.join(" -> ")));
            }
        }

        doc.push_str("## 4. Surprising Connections (Cross-Community Bridges)\n\n");
        if analysis.surprising_connections.is_empty() {
            doc.push_str("Clean community separation observed with no cross-boundary leaks.\n\n");
        } else {
            doc.push_str("| Source Entity | Target Entity | Relation | Confidence |\n");
            doc.push_str("| :--- | :--- | :--- | :--- |\n");
            for edge in &analysis.surprising_connections {
                let src_lbl = self.nodes.get(&edge.source).map_or(&edge.source, |n| &n.label);
                let tgt_lbl = self.nodes.get(&edge.target).map_or(&edge.target, |n| &n.label);
                doc.push_str(&format!(
                    "| `{}` | `{}` | `{}` | {} |\n",
                    src_lbl, tgt_lbl, edge.relation, edge.confidence
                ));
            }
            doc.push_str("\n");
        }

        doc
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_sample_graph() -> CodeGraph {
        let nodes = vec![
            CodeNode {
                id: "src/main.ts".into(),
                label: "main.ts".into(),
                source_file: "src/main.ts".into(),
                source_location: Some("L1".into()),
                node_type: "file".into(),
                community: None,
                degree: 0,
            },
            CodeNode {
                id: "src/server.ts".into(),
                label: "server.ts".into(),
                source_file: "src/server.ts".into(),
                source_location: Some("L1".into()),
                node_type: "file".into(),
                community: None,
                degree: 0,
            },
            CodeNode {
                id: "src/auth.ts".into(),
                label: "auth.ts".into(),
                source_file: "src/auth.ts".into(),
                source_location: Some("L1".into()),
                node_type: "file".into(),
                community: None,
                degree: 0,
            },
            CodeNode {
                id: "src/auth.ts::validateToken".into(),
                label: "validateToken()".into(),
                source_file: "src/auth.ts".into(),
                source_location: Some("L25".into()),
                node_type: "function".into(),
                community: None,
                degree: 0,
            },
            CodeNode {
                id: "src/db.ts".into(),
                label: "db.ts".into(),
                source_file: "src/db.ts".into(),
                source_location: Some("L1".into()),
                node_type: "file".into(),
                community: None,
                degree: 0,
            },
        ];

        let edges = vec![
            CodeEdge {
                source: "src/main.ts".into(),
                target: "src/server.ts".into(),
                relation: "imports".into(),
                confidence: "EXTRACTED".into(),
            },
            CodeEdge {
                source: "src/server.ts".into(),
                target: "src/auth.ts".into(),
                relation: "imports".into(),
                confidence: "EXTRACTED".into(),
            },
            CodeEdge {
                source: "src/auth.ts".into(),
                target: "src/auth.ts::validateToken".into(),
                relation: "defines".into(),
                confidence: "EXTRACTED".into(),
            },
            CodeEdge {
                source: "src/auth.ts::validateToken".into(),
                target: "src/db.ts".into(),
                relation: "calls".into(),
                confidence: "EXTRACTED".into(),
            },
        ];

        CodeGraph::from_nodes_and_edges(nodes, edges)
    }

    #[test]
    fn test_god_nodes_and_degrees() {
        let graph = build_sample_graph();
        assert_eq!(graph.nodes.len(), 5);
        let god = graph.find_god_nodes(3);
        assert!(!god.is_empty());
    }

    #[test]
    fn test_affected_blast_radius() {
        let graph = build_sample_graph();
        // If db.ts changes, validateToken and auth and server and main should be affected in reverse
        let hits = graph.affected_nodes("src/db.ts", 4, None);
        assert!(!hits.is_empty());
        let hit_ids: Vec<String> = hits.iter().map(|h| h.node_id.clone()).collect();
        assert!(hit_ids.contains(&"src/auth.ts::validateToken".to_string()));
    }

    #[test]
    fn test_shortest_path() {
        let graph = build_sample_graph();
        let path = graph.shortest_path("src/main.ts", "src/db.ts");
        assert!(path.is_some());
        let p = path.unwrap();
        assert_eq!(p.first().unwrap().node_id, "src/main.ts");
        assert_eq!(p.last().unwrap().node_id, "src/db.ts");
        assert_eq!(p.len(), 5);
    }

    #[test]
    fn test_cycle_detection() {
        let mut graph = build_sample_graph();
        // Introduce a cycle: db.ts -> main.ts
        graph.forward_adj.entry("src/db.ts".into()).or_default().push((
            "src/main.ts".into(),
            "imports".into(),
            "EXTRACTED".into(),
        ));
        let cycles = graph.find_cycles(5);
        assert_eq!(cycles.len(), 1);
        assert_eq!(cycles[0].length, 5);
    }

    #[test]
    fn test_report_generation() {
        let mut graph = build_sample_graph();
        let report = graph.generate_report("test-project");
        assert!(report.contains("Architecture Knowledge Graph Report"));
        assert!(report.contains("Total Entities (Nodes):** 5"));
    }
}
