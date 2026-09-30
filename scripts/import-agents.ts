import fs from "fs/promises";
import path from "path";

async function main() {
  const output = [];
  
  // 1. Process markdown agents
  const agentsDir = "v:/pankaj/agents";
  const mdFiles = await fs.readdir(agentsDir);
  
  for (const file of mdFiles) {
    if (!file.endsWith(".md")) continue;
    const content = await fs.readFile(path.join(agentsDir, file), "utf-8");
    
    // Parse frontmatter
    let name = file.replace(".md", "");
    let description = "";
    let color = "";
    let prompt = content;
    
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const nameMatch = fm.match(/name:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();
      
      const descMatch = fm.match(/description:\s*(.+)/);
      if (descMatch) description = descMatch[1].trim();
      
      const colorMatch = fm.match(/color:\s*(.+)/);
      if (colorMatch) color = colorMatch[1].trim();
      
      prompt = content.slice(frontmatterMatch[0].length).trim();
    }
    
    output.push(`  "${file.replace(".md", "")}": {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(description)},
    mode: "subagent",
    native: false,
    color: ${JSON.stringify(color || "gray")},
    options: {},
    prompt: ${JSON.stringify(prompt)},
    permission: Permission.merge(defaults, user),
  }`);
  }

  // 2. Process legacy TS agents
  const legacyDir = "v:/pankaj/navi-github/packages/navi/src/agent/specialized";
  const tsFiles = await fs.readdir(legacyDir);
  
  for (const file of tsFiles) {
    if (!file.endsWith(".ts") || file === "index.ts") continue;
    const content = await fs.readFile(path.join(legacyDir, file), "utf-8");
    
    // Quick regex parsing for the legacy AgentTemplate
    const idMatch = content.match(/id:\s*"([^"]+)"/);
    const nameMatch = content.match(/name:\s*"([^"]+)"/);
    const descMatch = content.match(/description:\s*"([^"]+)"/);
    const phaseMatch = content.match(/phase:\s*"([^"]+)"/);
    
    if (idMatch && nameMatch) {
      const id = idMatch[1];
      const name = nameMatch[1];
      const desc = descMatch ? descMatch[1] : "";
      const phase = phaseMatch ? phaseMatch[1] : "unknown";
      
      // Skills
      let skills = [];
      const skillsMatch = content.match(/skills:\s*\[(.*?)\]/);
      if (skillsMatch) {
         skills = skillsMatch[1].split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);
      }
      
      const prompt = "You are the " + name + " agent. Your phase is " + phase + "." + 
         (skills.length > 0 ? "\\n\\nYou possess the following specialized skills: " + skills.join(", ") + "." : "");
         
      output.push(`  "${id}": {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(desc)},
    mode: "subagent",
    native: false,
    color: "gray",
    options: {},
    prompt: ${JSON.stringify(prompt)},
    permission: Permission.merge(defaults, user),
  }`);
    }
  }

  const result = `import { Permission } from "@/permission";\nimport { Info } from "./agent";\n\nexport function getImportedAgents(defaults: Permission.Ruleset, user: Permission.Ruleset): Record<string, Info> {\n  return {\n${output.join(",\n")}\n  } as any;\n}`;
  
  await fs.writeFile("v:/pankaj/navi-reborn/packages/navi/src/agent/imported.ts", result);
  console.log("Import successful!");
}

main().catch(console.error);
