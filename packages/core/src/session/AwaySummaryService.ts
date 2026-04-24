import { Session } from "./index"
import { Log } from "../util/log"
import { Identifier } from "../id"
import { SessionID, MessageID } from "./schema"

const log = Log.create({ service: "away-summary" })

/**
 * AwaySummaryService tracks user engagement and provides a summary 
 * of background agent activity when the user returns.
 */
export class AwaySummaryService {
    private static lastReadMessageId = new Map<SessionID, MessageID>()

    /**
     * Mark all current messages in a session as "Read" by the user.
     */
    static async markAsRead(sessionID: string) {
        const id = SessionID.make(sessionID)
        const messages = await Session.messages({ sessionID: id, limit: 1 })
        if (messages.length > 0) {
            this.lastReadMessageId.set(id, messages[0].info.id)
            log.info("Marked session as read", { sessionID: id, messageID: messages[0].info.id })
        }
    }

    /**
     * Checks if there is significant unread activity to summarize.
     */
    static async getUnreadSummary(sessionID: string): Promise<string | null> {
        const id = SessionID.make(sessionID)
        const lastRead = this.lastReadMessageId.get(id)
        if (!lastRead) return null

        const allMessages = await Session.messages({ sessionID: id })
        const unread = allMessages.filter(m => m.info.id > lastRead && m.info.role === 'assistant')

        if (unread.length < 3) return null // Too few messages to bother summarizing

        log.info("Generating away summary", { sessionID, unreadCount: unread.length })

        // Extract the core actions taken by assistant
        const actions = unread
            .map(m => m.parts.map(p => 'text' in p ? p.text : '').join(' '))
            .join('\n')

        return `While you were away, the agent performed ${unread.length} tasks:\n${actions.substring(0, 500)}...`
    }
}




