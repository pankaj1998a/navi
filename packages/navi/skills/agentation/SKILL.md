---
name: agentation
description: "Add Agentation visual feedback toolbar to a Next.js or React project and verify MCP sync."
---

# Agentation Setup

Set up the visual feedback toolbar and connect it to Navi's coding agent loop.

## Steps

1. **Inspect the Project**:
   - Check `package.json` for React/Next.js/Vite and detect the package manager (bun, pnpm, npm).
   - Look for `agentation` dependency before installing.
   - If missing, install:
     ```bash
     bun add -d agentation # or npm install -D agentation
     ```

2. **Mount the Component in Development**:
   - **Next.js App Router**: Render in `app/layout.tsx` inside `<body>` after children:
     ```tsx
     import { Agentation } from "agentation";

     export default function RootLayout({ children }: { children: React.ReactNode }) {
       return (
         <html lang="en">
           <body>
             {children}
             {process.env.NODE_ENV === "development" && (
               <Agentation endpoint="http://localhost:4747" />
             )}
           </body>
         </html>
       );
     }
     ```
   - **Vite / React SPA**: Mount in `src/App.tsx` or root render tree:
     ```tsx
     import { Agentation } from "agentation";
     // ...
     {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
     ```

3. **Configure Navi Agentation MCP**:
   - Run:
     ```bash
     navi mcp add agentation
     ```
   - Start the Agentation background server:
     ```bash
     npx -y agentation-mcp server
     ```

4. **Run Live Autonomous Review**:
   - In Navi, invoke:
     ```text
     /watch-ui
     ```
   - Navi's `visual-reviewer` subagent will continuously watch for new annotations, inspect the UI, edit the relevant source code, and resolve annotations.
