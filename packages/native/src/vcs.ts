import simpleGit, { SimpleGit } from 'simple-git'

export interface GitStatus {
    changed: string[]
    staged: string[]
    untracked: string[]
    branch: string
}

export class VCS {
    private git: SimpleGit

    constructor(cwd: string) {
        this.git = simpleGit(cwd)
    }

    static from(cwd: string): VCS {
        return new VCS(cwd)
    }

    async getStatus(): Promise<GitStatus> {
        const status = await this.git.status()
        return {
            changed: status.modified,
            staged: status.staged,
            untracked: status.not_added,
            branch: status.current || 'HEAD'
        }
    }

    async getDiff(staged = false): Promise<string> {
        return this.git.diff(staged ? ['--cached'] : [])
    }

    async stage(files: string[]): Promise<void> {
        await this.git.add(files)
    }

    async commit(message: string): Promise<void> {
        await this.git.commit(message)
    }

    async getHistory(limit = 10): Promise<string> {
        const log = await this.git.log(['-n', limit.toString()])
        return log.all.map(c => `${c.hash.substring(0, 7)} ${c.message} (${c.author_name})`).join('\n')
    }

    async getBranch(): Promise<string> {
        const status = await this.git.status()
        return status.current || 'HEAD'
    }
}
