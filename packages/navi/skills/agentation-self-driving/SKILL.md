---
name: agentation-self-driving
description: "Autonomous design critique mode using the Agentation annotation toolbar and browser tools: inspecting layout, adding visual critique annotations, and driving live UI remediation."
---

# Agentation Self-Driving Mode

Autonomously critique a web page by inspecting layout, checking spacing rhythm and visual hierarchy, and creating element-precise annotations via the Agentation toolbar or direct browser automation.

## The Loop

1. **Navigate to the target application**:
   Use the `browser` tool:
   - `action: "navigate"`, `url: "http://localhost:<port>"`
   - `action: "screenshot"` to capture the initial viewport state.

2. **Verify Agentation Toolbar** (if embedded):
   - Check if `<agentation-toolbar>` exists on the page via `evaluate`:
     ```js
     (document.querySelector('agentation-toolbar')?.shadowRoot || document).querySelector('[data-feedback-toolbar]') ? 'toolbar found' : 'NOT FOUND'
     ```
   - If present, expand the toolbar if collapsed.

3. **Traverse and Critique**:
   Work through the page top-to-bottom:
   - **Hero / Header**: Visual hierarchy, primary CTA contrast, title typography.
   - **Navigation**: Alignment, padding, responsive collapse.
   - **Content Sections & Cards**: Consistent spacing rhythm, visual depth, Gestalt grouping.
   - **Forms & Interactive Controls**: Focus states, clear labels, click targets.
   - **Footer / Legal**: Visual separation, readability.

4. **Coordinate-Based Interaction & Annotation**:
   When using the Agentation overlay, standard DOM clicks are intercepted at the coordinate level:
   - Use `action: "box"`, `selector: "<css-selector>"` to get element coordinates (`centerX`, `centerY`).
   - Use `action: "mouse_click"`, `coordinate: { x: centerX, y: centerY }` to trigger the annotation dialog on the overlay.
   - Type feedback into the annotation dialog and submit.

5. **Direct Remediation**:
   - For each identified visual defect, locate the source file using `grep` or file search.
   - Apply clean, surgical edits to CSS/JSX/TSX.
   - Re-capture a screenshot using `action: "screenshot"` to prove the visual improvement.
