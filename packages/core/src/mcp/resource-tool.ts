import z from "zod";
import { Tool } from "../tool/tool";
import { MCP } from "./index";

/**
 * McpResourceTool allows the model to read resources from any connected MCP server.
 */
export const McpResourceTool = Tool.define("read_mcp_resource", {
  description: "Read a resource from a connected MCP server using its URI.",
  parameters: z.object({
    clientName: z.string().describe("The name of the MCP server"),
    resourceUri: z.string().describe("The URI of the resource to read"),
  }),
  execute: async ({ clientName, resourceUri }) => {
    const result = await MCP.readResource(clientName, resourceUri);
    if (!result) {
      return { 
        output: `Resource not found or failed to read: ${resourceUri}`, 
        title: "MCP Resource",
        metadata: { uri: resourceUri, client: clientName }
      };
    }

    const content = result.contents.map(c => {
      if ('text' in c) return (c as any).text;
      if ('blob' in c) return `[Binary Data: ${(c as any).mimeType}]`;
      return "";
    }).join("\n\n");

    return {
      output: content,
      title: `MCP Resource: ${resourceUri}`,
      metadata: { uri: resourceUri, client: clientName }
    };
  },
});

/**
 * McpListResourcesTool allows the model to list resources from all connected MCP servers.
 */
export const McpListResourcesTool = Tool.define("list_mcp_resources", {
  description: "List all available resources and templates from all connected MCP servers.",
  parameters: z.object({}),
  execute: async () => {
    const resources = await MCP.resources();
    const items = Object.entries(resources);
    
    if (items.length === 0) {
      return { 
        output: "No MCP resources found.", 
        title: "MCP Resources",
        metadata: { count: 0 }
      };
    }

    const content = items.map(([id, info]) => {
      const type = 'uriTemplate' in info ? 'Template' : 'Resource';
      return `- **${info.name}** (${type})\n  ID: ${id}\n  URI: ${'uriTemplate' in info ? (info as any).uriTemplate : (info as any).uri}\n  Description: ${info.description || 'No description'}`;
    }).join("\n\n");

    return {
      output: `Found ${items.length} MCP resources:\n\n${content}`,
      title: "MCP Resources",
      metadata: { count: items.length }
    };
  },
});

