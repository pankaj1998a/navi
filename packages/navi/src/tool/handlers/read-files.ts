import { fileOps } from '@navi-ai/native'
import path from 'path'
import { Instance } from '../../project/instance'

export interface ReadFilesParams {
    paths: string[]
}

export interface ReadFilesResult {
    files: Array<{
        path: string
        content: string
        size: number
    }>
}

export async function handleReadFiles(params: ReadFilesParams): Promise<ReadFilesResult> {
    const cwd = Instance.directory
    const files = await fileOps.readFiles(cwd, params.paths)

    return { files }
}
