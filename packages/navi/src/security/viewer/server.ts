/**
 * Local Interactive Web Viewer Dashboard for Navi Pentest Runs
 * Modeled after `strix view`, providing a zero-dependency web dashboard
 * for inspecting findings, PoCs, coverage, and replaying HTTP requests.
 */

import { globalPentestStore } from "../reporter"
import { globalCoverageStore } from "../coverage"
import { globalHttpTraffic } from "../proxy/http-traffic"
import { globalPentestNotes } from "../notes"
import { generateSarifReport } from "../sarif"
import open from "open"

export interface ViewerOptions {
  host?: string
  port?: number
  openBrowser?: boolean
}

export function startViewerServer(options: ViewerOptions = {}): { url: string; stop: () => void } {
  const host = options.host || "127.0.0.1"
  const port = options.port || 4040

  const server = Bun.serve({
    hostname: host,
    port,
    fetch(req) {
      const url = new URL(req.url)

      // API Endpoints
      if (url.pathname === "/api/summary") {
        return Response.json({
          summary: globalPentestStore.getSummary(),
          coverage: globalCoverageStore.getSummary(),
        })
      }

      if (url.pathname === "/api/findings") {
        return Response.json(globalPentestStore.listFindings())
      }

      if (url.pathname === "/api/coverage") {
        return Response.json(globalCoverageStore.list())
      }

      if (url.pathname === "/api/traffic") {
        return Response.json(globalHttpTraffic.list())
      }

      if (url.pathname === "/api/notes") {
        return Response.json(globalPentestNotes.list())
      }

      if (url.pathname === "/api/export/markdown") {
        return new Response(globalPentestStore.generateMarkdownReport(), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": 'attachment; filename="penetration_test_report.md"',
          },
        })
      }

      if (url.pathname === "/api/export/sarif") {
        return new Response(JSON.stringify(generateSarifReport(globalPentestStore.listFindings()), null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": 'attachment; filename="findings.sarif"',
          },
        })
      }

      // Serve Single-Page Dashboard HTML
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(renderDashboardHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  const url = `http://${host}:${server.port}`
  if (options.openBrowser !== false) {
    open(url).catch(() => {})
  }

  return {
    url,
    stop: () => server.stop(),
  }
}

function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Navi Pentest — Live Security Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: rgba(18, 20, 29, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent: #10b981;
      --critical: #ef4444;
      --high: #f97316;
      --medium: #f59e0b;
      --low: #3b82f6;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(13, 15, 22, 0.9);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 20px; }
    .brand span { color: var(--accent); }
    .btn-group { display: flex; gap: 10px; }
    .btn {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
      border: 1px solid var(--card-border);
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      font-size: 13px;
      transition: all 0.2s;
    }
    .btn:hover { background: rgba(255, 255, 255, 0.12); border-color: rgba(255, 255, 255, 0.2); }
    .btn-primary { background: var(--accent); color: #000; border: none; }
    .btn-primary:hover { background: #059669; }
    main { padding: 32px; max-width: 1400px; margin: 0 auto; width: 100%; flex: 1; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .metric-label { font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .metric-val { font-size: 32px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--card-border); margin-bottom: 24px; }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 12px 20px;
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .finding-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .finding-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .finding-title { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
    }
    .badge-critical { background: rgba(239, 68, 68, 0.2); color: var(--critical); border: 1px solid var(--critical); }
    .badge-high { background: rgba(249, 115, 22, 0.2); color: var(--high); border: 1px solid var(--high); }
    .badge-medium { background: rgba(245, 158, 11, 0.2); color: var(--medium); border: 1px solid var(--medium); }
    .badge-low { background: rgba(59, 130, 246, 0.2); color: var(--low); border: 1px solid var(--low); }
    pre {
      background: #000;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      overflow-x: auto;
      margin: 12px 0;
      color: #38bdf8;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; background: var(--card-bg); border-radius: 10px; overflow: hidden; }
    th, td { padding: 14px 18px; text-align: left; border-bottom: 1px solid var(--card-border); font-size: 14px; }
    th { background: rgba(255, 255, 255, 0.03); color: var(--text-muted); font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <div class="brand">🛡️ <span>Navi</span> Pentest Viewer</div>
    <div class="btn-group">
      <a href="/api/export/markdown" class="btn" download>Export Markdown</a>
      <a href="/api/export/sarif" class="btn" download>Export SARIF 2.1.0</a>
      <button class="btn btn-primary" onclick="loadAllData()">Refresh</button>
    </div>
  </header>
  <main>
    <div class="metrics">
      <div class="metric-card"><div class="metric-label">🔴 Critical Findings</div><div class="metric-val" id="cnt-critical" style="color: var(--critical)">0</div></div>
      <div class="metric-card"><div class="metric-label">🟠 High Findings</div><div class="metric-val" id="cnt-high" style="color: var(--high)">0</div></div>
      <div class="metric-card"><div class="metric-label">🟡 Medium Findings</div><div class="metric-val" id="cnt-medium" style="color: var(--medium)">0</div></div>
      <div class="metric-card"><div class="metric-label">🔵 Low Findings</div><div class="metric-val" id="cnt-low" style="color: var(--low)">0</div></div>
      <div class="metric-card"><div class="metric-label">🎯 Attack Surface</div><div class="metric-val" id="cnt-endpoints" style="color: var(--accent)">0</div></div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('findings')">Validated Findings & PoCs</button>
      <button class="tab-btn" onclick="switchTab('coverage')">Attack Surface Coverage</button>
      <button class="tab-btn" onclick="switchTab('traffic')">HTTP Proxy Interceptor</button>
      <button class="tab-btn" onclick="switchTab('notes')">Red Team Notes</button>
    </div>

    <div id="tab-findings" class="tab-panel active">
      <div id="findings-list">Loading findings...</div>
    </div>

    <div id="tab-coverage" class="tab-panel">
      <table>
        <thead><tr><th>Method</th><th>Endpoint</th><th>Parameters</th><th>Status</th><th>Categories Tested</th></tr></thead>
        <tbody id="coverage-body"></tbody>
      </table>
    </div>

    <div id="tab-traffic" class="tab-panel">
      <table>
        <thead><tr><th>ID</th><th>Method</th><th>URL</th><th>Status</th><th>Duration</th></tr></thead>
        <tbody id="traffic-body"></tbody>
      </table>
    </div>

    <div id="tab-notes" class="tab-panel">
      <div id="notes-list"></div>
    </div>
  </main>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
    }

    async function loadAllData() {
      try {
        const sumRes = await fetch('/api/summary');
        const sumData = await sumRes.json();
        document.getElementById('cnt-critical').textContent = sumData.summary.critical;
        document.getElementById('cnt-high').textContent = sumData.summary.high;
        document.getElementById('cnt-medium').textContent = sumData.summary.medium;
        document.getElementById('cnt-low').textContent = sumData.summary.low;
        document.getElementById('cnt-endpoints').textContent = sumData.coverage.totalEndpoints;

        const fRes = await fetch('/api/findings');
        const findings = await fRes.json();
        const fDiv = document.getElementById('findings-list');
        if (findings.length === 0) {
          fDiv.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted)">No verified vulnerabilities recorded yet.</div>';
        } else {
          fDiv.innerHTML = findings.map(f => \`
            <div class="finding-card">
              <div class="finding-header">
                <div class="finding-title">
                  <span class="badge badge-\${f.severity}">\${f.severity} (CVSS \${f.cvss_score.toFixed(1)})</span>
                  \${f.title}
                </div>
                <div style="font-family: monospace; font-size: 12px; color: var(--text-muted)">\${f.id}</div>
              </div>
              <p style="color: var(--text-muted); margin-bottom: 12px">\${f.description}</p>
              <div style="margin-bottom: 8px"><strong>Target:</strong> <code>\${f.target}</code></div>
              <div style="margin-bottom: 8px"><strong>Impact:</strong> \${f.impact}</div>
              <div style="margin-top: 12px"><strong>Verified Proof of Concept (PoC):</strong></div>
              <pre><code>\${f.poc_script_code}</code></pre>
              <div style="margin-top: 12px"><strong>Remediation:</strong> \${f.remediation_steps}</div>
            </div>
          \`).join('');
        }

        const covRes = await fetch('/api/coverage');
        const covData = await covRes.json();
        document.getElementById('coverage-body').innerHTML = covData.map(c => \`
          <tr>
            <td><strong>\${c.method}</strong></td>
            <td><code>\${c.endpoint}</code></td>
            <td>\${(c.parameters || []).join(', ') || '-'}</td>
            <td><span class="badge \${c.status === 'vulnerable' ? 'badge-critical' : 'badge-low'}">\${c.status}</span></td>
            <td>\${(c.tested_vulnerability_types || []).join(', ') || '-'}</td>
          </tr>
        \`).join('');

        const trafRes = await fetch('/api/traffic');
        const trafData = await trafRes.json();
        document.getElementById('traffic-body').innerHTML = trafData.map(t => \`
          <tr>
            <td>#\${t.id}</td>
            <td><strong>\${t.method}</strong></td>
            <td><code>\${t.url}</code></td>
            <td><span class="badge badge-low">\${t.response ? t.response.statusCode : '-'}</span></td>
            <td>\${t.response ? t.response.durationMs + 'ms' : '-'}</td>
          </tr>
        \`).join('');

        const notesRes = await fetch('/api/notes');
        const notes = await notesRes.json();
        document.getElementById('notes-list').innerHTML = notes.map(n => \`
          <div class="finding-card">
            <h3>\${n.title}</h3>
            <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 10px">Tags: \${n.tags.join(', ')}</div>
            <pre><code>\${n.content}</code></pre>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }
    loadAllData();
  </script>
</body>
</html>`;
}
