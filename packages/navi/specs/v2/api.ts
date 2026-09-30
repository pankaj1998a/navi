// @ts-nocheck

import { Navi } from "@navi-ai/core"
import { ReadTool } from "@navi-ai/core/tools"

const navi = Navi.make({})

navi.tool.add(ReadTool)

navi.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

navi.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

navi.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await navi.session.create({
  agent: "build",
})

navi.subscribe((event) => {
  console.log(event)
})

await navi.session.prompt({
  sessionID,
  text: "hey what is up",
})

await navi.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await navi.session.wait()

console.log(await navi.session.messages(sessionID))
