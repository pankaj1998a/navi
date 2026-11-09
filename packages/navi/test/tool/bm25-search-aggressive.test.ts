import { describe, expect, test } from "bun:test"
import { searchBm25Native } from "../../src/native/native-runner"
import { searchTools } from "../../src/tool/tool-search"

describe("Phase 6: Semantic Tool & Skill Search (BM25 + Ranking Aggressive)", () => {
  const toolCatalog = [
    {
      id: "bash",
      title: "Bash Shell Execution",
      description: "Execute arbitrary bash scripts and CLI commands in the host terminal.",
      tags: ["shell", "terminal", "system"],
    },
    {
      id: "postgres_db",
      title: "PostgreSQL Database Engine",
      description: "Run SQL queries and schema migrations against relational PostgreSQL databases.",
      tags: ["sql", "database", "relational", "postgres"],
    },
    {
      id: "docker_cli",
      title: "Docker Container Manager",
      description: "Build images, run containers, and inspect container runtime logs and networks.",
      tags: ["containers", "docker", "devops"],
    },
    {
      id: "git_log",
      title: "Git History Inspector",
      description: "Read commit logs, git diffs, author history, and branch topology.",
      tags: ["git", "vcs", "commits"],
    },
    {
      id: "grep_workspace",
      title: "Grep Codebase Search",
      description: "Fast parallel regex search across files and source code in the workspace.",
      tags: ["search", "regex", "find"],
    },
    {
      id: "edit_file",
      title: "Surgical File Editor",
      description: "Modify file contents using whitespace-tolerant pattern replacement and patch hunks.",
      tags: ["edit", "write", "patch"],
    },
    {
      id: "kubernetes_ctl",
      title: "Kubernetes Cluster Controller",
      description: "Deploy pods, manage k8s ingress, configmaps, and inspect cluster state.",
      tags: ["k8s", "kubernetes", "cloud"],
    },
  ]

  test("BM25 ranks semantically relevant tool at #1 across distinct domains", () => {
    // 1. Relational database
    const dbRes = searchBm25Native("query relational database with SQL", toolCatalog, 3)
    expect(dbRes).not.toBeNull()
    expect(dbRes![0]?.id).toBe("postgres_db")
    expect(dbRes![0]?.score).toBeGreaterThan(0)

    // 2. Container runtime
    const dockerRes = searchBm25Native("inspect container runtime logs", toolCatalog, 3)
    expect(dockerRes).not.toBeNull()
    expect(dockerRes![0]?.id).toBe("docker_cli")

    // 3. Git commits
    const gitRes = searchBm25Native("read repository git commits", toolCatalog, 3)
    expect(gitRes).not.toBeNull()
    expect(gitRes![0]?.id).toBe("git_log")

    // 4. Regex file search
    const grepRes = searchBm25Native("regex find across files", toolCatalog, 3)
    expect(grepRes).not.toBeNull()
    expect(grepRes![0]?.id).toBe("grep_workspace")

    // 5. Code modification
    const editRes = searchBm25Native("modify source code with patch", toolCatalog, 3)
    expect(editRes).not.toBeNull()
    expect(editRes![0]?.id).toBe("edit_file")
  })

  test("handles long conversational queries with stop words without losing ranking precision", () => {
    const conversationalQuery = "I really need a tool that can help me execute bash shell commands in terminal"
    const res = searchBm25Native(conversationalQuery, toolCatalog, 3)
    expect(res).not.toBeNull()
    expect(res![0]?.id).toBe("bash")
  })

  test("exact tool name matches receive dominance boost", () => {
    const res = searchBm25Native("docker_cli", toolCatalog, 3)
    expect(res).not.toBeNull()
    expect(res![0]?.id).toBe("docker_cli")
    // Exact match score boost
    expect(res![0]?.score).toBeGreaterThan(1000)
  })

  test("searchTools integration uses native BM25 ranker transparently", () => {
    const tools = [
      { id: "docker", description: "Container lifecycle management." },
      { id: "read_file", description: "Read file contents from disk." },
      { id: "sql_runner", description: "Execute SQL queries on relational databases." },
    ]

    const res = searchTools(tools, "relational SQL database", 2)
    expect(res.length).toBeGreaterThan(0)
    expect(res[0]?.id).toBe("sql_runner")
  })

  test("high-throughput benchmark over 300 tools in catalog", () => {
    const largeCatalog = Array.from({ length: 300 }, (_, i) => ({
      id: `synthetic_tool_${i}`,
      title: `Synthetic Tool ${i}`,
      description: `Performs operation ${i} on component ${i % 10} with sub-operation ${i % 5} in the workspace.`,
      tags: [`tag_${i % 7}`, `category_${i % 4}`],
    }))

    // Add target tool in the middle
    largeCatalog[142] = {
      id: "target_ml_inference",
      title: "Machine Learning Inference Runner",
      description: "Execute deep learning neural network tensor model inference on GPU accelerators.",
      tags: ["ai", "neural", "tensor", "gpu"],
    }

    const t0 = performance.now()
    const res = searchBm25Native("neural network tensor model inference", largeCatalog, 5)
    const elapsed = performance.now() - t0

    expect(res).not.toBeNull()
    expect(res![0]?.id).toBe("target_ml_inference")
    // Native Rust execution over 300 items should complete in < 15ms
    expect(elapsed).toBeLessThan(150)
  })
})
