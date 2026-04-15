declare module 'diff' {
    export interface Hunk {
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: string[];
    }

    export interface ParsedDiff {
        oldFileName?: string;
        newFileName?: string;
        oldHeader?: string;
        newHeader?: string;
        hunks: Hunk[];
    }

    export interface Change {
        value: string;
        count?: number;
        added?: boolean;
        removed?: boolean;
    }

    export function parsePatch(patch: string, options?: any): ParsedDiff[];
    export function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: any): string;
    export function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: any): string;
    export function applyPatch(source: string, patch: any, options?: any): string | false;
    export function diffLines(oldStr: string, newStr: string, options?: any): Change[];
    export function formatPatch(diff: any): string;
    export function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: any): ParsedDiff;

    // Catch-all
    // export function [name: string]: any;
}

