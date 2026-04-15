import { describe, it, expect, mock, beforeEach } from "bun:test"
import { CheckpointTool } from "./checkpoint"
import { Session } from "../session"
import { Snapshot } from "../snapshot"

mock.module("../session", () => ({
    Session: {
        messages: mock(),
    },
}))

mock.module("../snapshot", () => ({
    Snapshot: {
        restore: mock(),
    },
}))

mock.module("./truncation", () => ({
    Truncate: {
        output: mock().mockImplementation((text) => Promise.resolve({ content: text, truncated: false })),
    },
}))

mock.module("../util/log", () => ({
    Log: {
        create: mock().mockReturnValue({
            info: mock(),
            error: mock(),
            warn: mock(),
        }),
    },
}))

describe("CheckpointTool", () => {
    beforeEach(() => {
        // mock.restore() 
    })

    it("should list checkpoints", async () => {
        const tool = await CheckpointTool.init()
        const mockMessages = [
            {
                info: { id: "msg1", time: { created: 1000 }, role: "user" },
                parts: [
                    { type: "step-start", snapshot: "hash1" },
                ],
            },
            {
                info: { id: "msg2", time: { created: 2000, completed: 2500 }, role: "assistant" },
                parts: [
                    { type: "step-finish", snapshot: "hash2" },
                ],
            },
        ];

        (Session.messages as any).mockResolvedValue(mockMessages as any)

        const result = await tool.execute({ action: "list" }, { sessionID: "sess1" } as any)

        expect(result.output).toContain("hash2")
        expect(result.output).toContain("hash1")
        expect(result.output).toContain("finish")
        expect(result.output).toContain("start")
    })

    it("should restore checkpoint", async () => {
        const tool = await CheckpointTool.init()

        await tool.execute({ action: "restore", hash: "hash1" }, { sessionID: "sess1" } as any)

        expect(Snapshot.restore).toHaveBeenCalledWith("hash1")
    })

    it("should restore checkpoint with prefix", async () => {
        const tool = await CheckpointTool.init()
        const mockMessages = [
            {
                info: { id: "msg1", time: { created: 1000 }, role: "user" },
                parts: [
                    { type: "step-start", snapshot: "abcdef1234567890" },
                ],
            },
        ];

        (Session.messages as any).mockResolvedValue(mockMessages as any)

        await tool.execute({ action: "restore", hash: "abcdef" }, { sessionID: "sess1" } as any)

        expect(Snapshot.restore).toHaveBeenCalledWith("abcdef1234567890")
    })
})


