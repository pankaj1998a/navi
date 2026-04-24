import { Tool } from "./tool"
import z from "zod"
import { Session } from "../session"

/**
 * Tool to enter Planning Mode.
 * This sets the planningMode flag in the session to true.
 */
export const EnterPlanModeTool = Tool.define("enter_plan_mode", async (ctx) => {
    return {
        description: "Enter planning mode. This should be used when a task is complex and requires a structured approach before execution.",
        parameters: z.object({}),
        async execute(_, ctx) {
            await Session.setScratchpad({
                sessionID: ctx.sessionID,
                content: "Planning mode enabled.",
            })
            return {
                title: "Entered Planning Mode",
                output: "You are now in planning mode. Please propose an implementation plan and wait for user approval before making any changes.",
                metadata: {},
            }
        }
    }
})

/**
 * Tool to exit Planning Mode.
 * This sets the planningMode flag in the session to false.
 */
export const ExitPlanModeTool = Tool.define("exit_plan_mode", async (ctx) => {
    return {
        description: "Exit planning mode. This should be used after a plan has been approved and you are ready to execute.",
        parameters: z.object({}),
        async execute(_, ctx) {
            await Session.setScratchpad({
                sessionID: ctx.sessionID,
                content: "",
            })
            return {
                title: "Exited Planning Mode",
                output: "You have exited planning mode. You can now proceed with executing the approved plan.",
                metadata: {},
            }
        }
    }
})


