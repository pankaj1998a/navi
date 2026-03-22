declare module 'diff' {
    export interface ParsedDiff {
        index?: string
        oldFileName?: string
        newFileName?: string
        oldHeader?: string
        newHeader?: string
        hunks: Hunk[]
    }

    export interface Hunk {
        oldStart: number
        oldLines: number
        newStart: number
        newLines: number
        lines: string[]
        linedelimiters?: string[]
    }

    export interface Change {
        count?: number
        value: string
        added?: boolean
        removed?: boolean
    }

    export interface PatchOptions {
        context?: number
        ignoreWhitespace?: boolean
        stripTrailingCr?: boolean
        newlineIsToken?: boolean
    }

    export function parsePatch(diffStr: string): ParsedDiff[]
    export function applyPatch(source: string, patch: string | ParsedDiff, options?: any): string | false
    export function applyPatches(patches: ParsedDiff[], options: object): void
    export function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: PatchOptions): string
    export function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: PatchOptions): string
    export function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: PatchOptions): ParsedDiff
    export function formatPatch(patch: ParsedDiff | ParsedDiff[]): string
    export function diffChars(oldStr: string, newStr: string, options?: any): Change[]
    export function diffWords(oldStr: string, newStr: string, options?: any): Change[]
    export function diffWordsWithSpace(oldStr: string, newStr: string, options?: any): Change[]
    export function diffLines(oldStr: string, newStr: string, options?: any): Change[]
    export function diffTrimmedLines(oldStr: string, newStr: string, options?: any): Change[]
    export function diffSentences(oldStr: string, newStr: string, options?: any): Change[]
    export function diffCss(oldStr: string, newStr: string, options?: any): Change[]
    export function diffJson(oldObj: object, newObj: object, options?: any): Change[]
    export function diffArrays<T>(oldArr: T[], newArr: T[], options?: any): Change[]
    export function convertChangesToXML(changes: Change[]): string
    export function convertChangesToDMP(changes: Change[]): Array<[number, string]>
}
