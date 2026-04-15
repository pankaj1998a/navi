import { Bus } from "../bus"
import { Session } from "../session"
import fs from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import { iife } from "../util/iife"

const log = Log.create({ service: "livedoc" })

export namespace LiveDoc {
    export class Generator {
        private active = false
        private unsubscribe?: () => void
        
        constructor() {
            iife(async () => {
                await this.start()
            })
        }

        async start() {
            if (this.active) return
            this.active = true
            
            // Listen to Session.Event.Updated (or similar) from Bus
            this.unsubscribe = Bus.subscribeAll(async (event) => {
                if (event.type === "session.state" || event.type === "session.updated" || event.type === "session.message.added") {
                    // throttle or debounce might be needed in production
                    await this.generateDoc()
                }
            })
            log.info("LiveDoc background generator started.")
        }

        stop() {
             this.active = false
             if (this.unsubscribe) {
                 this.unsubscribe()
             }
        }

        private async generateDoc() {
            try {
                // In a perfect system, we'd only generate for the active session, but for now we'll write 
                // a summary file to process.cwd() / .navi / livedoc.md
                const outPath = path.join(process.cwd(), ".navi", "livedoc.md")
                const dir = path.dirname(outPath)
                await fs.mkdir(dir, { recursive: true })
                
                const time = new Date().toISOString()
                const md = `# LiveDoc™ - Real-Time Codebase Documentation\n\n*Last Updated: ${time}*\n\n## Recent AI Operations\nDocumentation blocks are automatically generated as the agent architecture runs. (Stub for V1)`
                
                await fs.writeFile(outPath, md, "utf-8")
            } catch(e) {
                log.warn("LiveDoc generation failed", { error: e })
            }
        }
    }
    
    // Singleton instance
    export const generator = new Generator()
}
