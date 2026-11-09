use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const K1: f64 = 1.2;
const B: f64 = 0.75;
const TITLE_WEIGHT: f64 = 3.0;
const TAG_WEIGHT: f64 = 2.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchDocument {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub id: String,
    pub title: String,
    pub description: String,
    pub score: f64,
}

#[derive(Debug, Deserialize)]
pub struct SearchQueryOptions {
    pub query: String,
    pub documents: Vec<SearchDocument>,
    pub limit: Option<usize>,
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|t| !t.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Okapi BM25 scoring engine for ranking tools, skills, and catalog items.
pub fn rank_documents(opts: &SearchQueryOptions) -> Vec<SearchResultItem> {
    let query_norm = opts.query.trim().to_lowercase();
    let query_tokens = tokenize(&query_norm);
    if query_tokens.is_empty() || opts.documents.is_empty() {
        return Vec::new();
    }

    let n = opts.documents.len() as f64;

    // Document token frequency and effective lengths
    let mut doc_lengths = Vec::with_capacity(opts.documents.len());
    let mut doc_token_counts: Vec<HashMap<String, f64>> = Vec::with_capacity(opts.documents.len());
    let mut doc_freq: HashMap<String, usize> = HashMap::new();

    for doc in &opts.documents {
        let title_tokens = tokenize(&doc.title);
        let id_tokens = tokenize(&doc.id);
        let desc_tokens = tokenize(&doc.description);

        let mut token_weights: HashMap<String, f64> = HashMap::new();
        let mut seen_tokens: HashSet<String> = HashSet::new();

        let mut effective_len = 0.0;

        for t in id_tokens.into_iter().chain(title_tokens) {
            *token_weights.entry(t.clone()).or_insert(0.0) += TITLE_WEIGHT;
            seen_tokens.insert(t);
            effective_len += TITLE_WEIGHT;
        }

        for tag in &doc.tags {
            for t in tokenize(tag) {
                *token_weights.entry(t.clone()).or_insert(0.0) += TAG_WEIGHT;
                seen_tokens.insert(t);
                effective_len += TAG_WEIGHT;
            }
        }

        for t in desc_tokens {
            *token_weights.entry(t.clone()).or_insert(0.0) += 1.0;
            seen_tokens.insert(t);
            effective_len += 1.0;
        }

        for t in seen_tokens {
            *doc_freq.entry(t).or_insert(0) += 1;
        }

        doc_lengths.push(effective_len.max(1.0));
        doc_token_counts.push(token_weights);
    }

    let avgdl = doc_lengths.iter().sum::<f64>() / n;

    // Compute scores
    let mut scored: Vec<SearchResultItem> = opts
        .documents
        .iter()
        .enumerate()
        .map(|(idx, doc)| {
            let mut score = 0.0;
            let d_len = doc_lengths[idx];
            let token_counts = &doc_token_counts[idx];

            let title_lower = doc.title.to_lowercase();
            let id_lower = doc.id.to_lowercase();

            // Exact match boost
            if id_lower == query_norm || title_lower == query_norm {
                score += 1000.0;
            } else if id_lower.contains(&query_norm) || title_lower.contains(&query_norm) {
                score += 50.0;
            }

            // BM25 calculation over query tokens
            for qt in &query_tokens {
                let df = *doc_freq.get(qt).unwrap_or(&0) as f64;
                if df == 0.0 {
                    // Check prefix match
                    for (doc_token, count) in token_counts {
                        if doc_token.starts_with(qt) || qt.starts_with(doc_token) {
                            score += count * 0.5;
                        }
                    }
                    continue;
                }

                // Standard Okapi BM25 IDF: ln(1 + (N - df + 0.5) / (df + 0.5))
                let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();

                let tf = *token_counts.get(qt).unwrap_or(&0.0);
                if tf > 0.0 {
                    let numerator = tf * (K1 + 1.0);
                    let denominator = tf + K1 * (1.0 - B + B * (d_len / avgdl));
                    score += idf * (numerator / denominator);
                } else {
                    // Check if query token is a prefix of any doc token
                    for (doc_token, count) in token_counts {
                        if doc_token.starts_with(qt) {
                            score += count * 0.3;
                        }
                    }
                }
            }

            SearchResultItem {
                id: doc.id.clone(),
                title: doc.title.clone(),
                description: doc.description.clone(),
                score,
            }
        })
        .filter(|item| item.score > 0.0)
        .collect();

    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });

    let limit = opts.limit.unwrap_or(5).clamp(1, 100);
    if scored.len() > limit {
        scored.truncate(limit);
    }

    scored
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_bm25_exact_and_semantic_ranking() {
        let docs = vec![
            SearchDocument {
                id: "bash".into(),
                title: "Run Command".into(),
                description: "Execute arbitrary bash shell commands on the host machine".into(),
                tags: vec!["terminal".into(), "shell".into()],
            },
            SearchDocument {
                id: "postgres_query".into(),
                title: "PostgreSQL Query".into(),
                description: "Execute SQL queries against a PostgreSQL database instance".into(),
                tags: vec!["db".into(), "sql".into(), "relational".into()],
            },
            SearchDocument {
                id: "grep".into(),
                title: "File Search".into(),
                description: "Search for regex patterns across files in the workspace".into(),
                tags: vec!["find".into(), "regex".into()],
            },
            SearchDocument {
                id: "edit_file".into(),
                title: "Edit Source File".into(),
                description: "Modify file contents using surgical pattern replacement".into(),
                tags: vec!["write".into(), "patch".into()],
            },
        ];

        // 1. Exact match for "postgres" should rank postgres_query at #1 with large score
        let res_pg = rank_documents(&SearchQueryOptions {
            query: "postgres".into(),
            documents: docs.clone(),
            limit: Some(3),
        });
        assert_eq!(res_pg[0].id, "postgres_query");
        assert!(res_pg[0].score > 50.0);

        // 2. Query for "terminal commands" should rank bash at #1
        let res_term = rank_documents(&SearchQueryOptions {
            query: "terminal commands".into(),
            documents: docs.clone(),
            limit: Some(3),
        });
        assert_eq!(res_term[0].id, "bash");

        // 3. Query for "surgical replacement" should rank edit_file at #1
        let res_edit = rank_documents(&SearchQueryOptions {
            query: "surgical replacement".into(),
            documents: docs,
            limit: Some(3),
        });
        assert_eq!(res_edit[0].id, "edit_file");
    }

    #[test]
    fn test_bm25_handles_empty_and_noise() {
        let docs = vec![SearchDocument {
            id: "test".into(),
            title: "Test".into(),
            description: "A simple test tool".into(),
            tags: vec![],
        }];

        let res = rank_documents(&SearchQueryOptions {
            query: "???".into(),
            documents: docs,
            limit: None,
        });
        assert!(res.is_empty());
    }
}
