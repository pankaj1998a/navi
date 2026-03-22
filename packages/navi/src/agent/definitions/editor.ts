import { Tool } from '../../tool/tool'

export const EditorAgent = {
    id: 'editor',
    name: 'Code Editor',
    description: 'Specialized agent for editing code files with precision',
    prompt: `You are an expert code editor. Your goal is to make precise changes to the codebase.
You have access to tools for reading, writing, and editing files.
Always verify your changes after making them.`,
    tools: ['read', 'write', 'edit', 'grep', 'find-files'],
    options: {
        color: 'blue'
    }
}
