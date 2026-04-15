import { fileOps } from '@navi-ai/native'
import { Instance } from '../../project/instance'

export interface WriteFileParams {
    filePath: string
    content: string
}

export interface WriteFileResult {
    path: string
    size: number
}

export async function handleWriteFile(params: WriteFileParams): Promise<WriteFileResult> {
    const cwd = Instance.directory
    await fileOps.writeFile(cwd, params.filePath, params.content)

    // Get size for result
    const entries = await fileOps.readFiles(cwd, [params.filePath])
    const size = entries[0]?.size || params.content.length

    return {
        path: params.filePath,
        size
    }
}


