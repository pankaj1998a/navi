export class AST {
    private static initialized = false

    static async init() {
        if (this.initialized) return
        this.initialized = true
    }

    static async getParser(language: string): Promise<any> {
        return {}
    }

    static async parse(content: string, language: string): Promise<any> {
        return {}
    }
}
