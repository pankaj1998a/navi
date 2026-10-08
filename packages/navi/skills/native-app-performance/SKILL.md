---
name: native-app-performance
description: "Desktop and native app performance: CPU/memory profiling, frame bottlenecks, hotspot ranking, trace extraction."
---

# Native & Desktop App Performance

Diagnose, profile, and optimize performance for native and desktop applications (Tauri, Electron, macOS/Windows binaries).

## Methodology

1. **Baseline Measurement**:
   - Establish baseline CPU usage, memory footprint (RSS/working set), and startup latency before refactoring.
   - Profile the exact slow path (window open, large list render, IPC bridge calls).

2. **Hotspot Isolation**:
   - Focus on top CPU consumers and blocking operations on the main/UI thread.
   - Look for unnecessary serialization across the frontend-to-native IPC bridge.
   - Defer heavy computation to background worker threads or native sidecars.

3. **Memory & Resource Leaks**:
   - Identify unclosed event listeners, retained DOM detached subtrees, and unbounded cache growth.
