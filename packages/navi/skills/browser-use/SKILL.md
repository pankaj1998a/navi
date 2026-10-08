---
name: browser-use
description: "Control headless or real Chrome: live UI inspection, coordinate interaction, screenshot proof, and dev-server debugging."
---

# Browser Use

Drive Chrome via Navi's integrated `browser` tool or `navi browser` CLI for live UI verification, dev server testing, and visual proof generation.

## Workflow

1. **Verify or Launch Dev Server**:
   - Ensure the web application is running locally (e.g. `http://localhost:3000` or `http://localhost:5173`).
   - Use the `browser` tool with `action="navigate"`, `url="http://localhost:3000"`.

2. **Inspect & Interact**:
   - **Locate Elements**:
     - Use `action="pick"`, `selector="<css-selector>"` or coordinate `{x, y}` to inspect DOM hierarchy, classes, tags, and data attributes.
     - Look for identifying attributes (`data-testid`, `data-component`, `aria-label`).
   - **Click & Type**:
     - Standard click: `action="click"`, `selector="button#submit"`
     - Canvas or floating overlay: `action="mouse_click"`, `coordinate: { x: 420, y: 180 }`
     - Form input: `action="type"`, `selector="input[name=email]"`, `text="test@example.com"`
     - Keyboard navigation: `action="press_key"`, `key="Enter"` or `"Tab"` or `"Escape"`

3. **Diagnose & Monitor**:
   - **Network Requests**: `action="network"` to inspect in-flight HTTP requests, responses, latencies, and network failures.
   - **Console Errors**: `action="console"` to stream runtime JavaScript errors and warnings.

4. **Capture Evidence & Proof**:
   - Capture full page: `action="screenshot"`, `fullPage=true`, `name="ui-proof"`
   - Viewport resizing for mobile responsiveness: `action="viewport"`, `viewportSize: { width: 375, height: 812, isMobile: true }`

5. **Clean Session Teardown**:
   - Close tabs when complete: `action="close_tab"` or `action="close"` to free resources.
