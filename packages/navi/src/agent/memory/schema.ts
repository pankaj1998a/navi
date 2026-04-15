export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryMetadata {
    name: string;
    description: string;
    type: MemoryType;
    scope: "private" | "team";
}

export interface MemoryRecord extends MemoryMetadata {
    content: string;
    filepath: string;
    mtimeMs: number;
}
