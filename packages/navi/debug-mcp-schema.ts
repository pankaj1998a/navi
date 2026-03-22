import { MCP } from "./src/mcp"
import { iife } from "./src/util/iife"

async function debugMcpTools() {
    console.log("=== Debugging MCP Tools Schemas ===")
    
    try {
        const tools = await MCP.tools()
        console.log("Found tools:", Object.keys(tools))
        
        const exaToolId = Object.keys(tools).find(k => k.includes("web_search_exa"))
        if (!exaToolId) {
            console.error("❌ web_search_exa tool not found. Is EXA_API_KEY set?")
            return
        }
        
        const tool = tools[exaToolId]
        console.log("\nTool ID:", exaToolId)
        
        // Inspect the tool object content
        const toolAny = tool as any
        console.log("\nTool Properties:", Object.keys(toolAny))
        
        if (toolAny.parameters) {
            console.log("\nTool Parameters (jsonSchema):", JSON.stringify(toolAny.parameters, null, 2))
        } else if (toolAny.inputSchema) {
            console.log("\nTool InputSchema (jsonSchema):", JSON.stringify(toolAny.inputSchema, null, 2))
        } else {
            console.log("\n❌ No parameters or inputSchema found on tool object")
        }

    } catch (error) {
        console.error("Error:", error)
    }
}

debugMcpTools()
