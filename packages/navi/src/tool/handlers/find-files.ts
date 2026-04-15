import { fileOps } from '@navi-ai/native'
import { Instance } from '../../project/instance'

export interface FindFilesParams {
    patterns: string[]
    ignore?: string[]
}

export interface FindFilesResult {
    paths: string[]
}

export async function handleFindFiles(params: FindFilesParams): Promise<FindFilesResult> {
    const cwd = Instance.directory
    const paths = await fileOps.findFiles(cwd, params.patterns, params.ignore || [])

    return { paths }
}


