import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Auth } from "../../auth"
import { Instance } from "../../project/instance"
import { AuthLoginCommand } from "./auth"
import path from "path"

export const InitCommand = cmd({
    command: "init",
    describe: "help set up navi",
    async handler() {
        await Instance.provide({
            directory: process.cwd(),
            async fn() {
                UI.empty()
                UI.println(UI.logo("  "))
                UI.empty()
                prompts.intro("Welcome to Navi!")

                prompts.log.info("Navi is your AI terminal partner.")

                // 1. Check Auth
                const credentials = await Auth.all()
                const hasCredentials = Object.keys(credentials).length > 0

                if (!hasCredentials) {
                    const shouldLogin = await prompts.confirm({
                        message: "No AI providers configured. Would you like to log in to one now?",
                        initialValue: true,
                    })

                    if (shouldLogin && !prompts.isCancel(shouldLogin)) {
                        // Invoke AuthLoginCommand to handle the login flow
                        await AuthLoginCommand.handler({ url: undefined } as any)
                    } else {
                        prompts.log.warn("You will need to configure a provider later using `navi auth login`.")
                    }
                } else {
                    prompts.log.success(
                        `Found ${Object.keys(credentials).length} provider(s) configured: ${Object.keys(credentials).join(", ")}`,
                    )
                }

                // 2. Local Config
                // Check if we are in a clean directory or if we want to set up local config
                const projectConfigPath = path.join(process.cwd(), "navi.json")
                const hasProjectConfig = await Bun.file(projectConfigPath).exists()

                if (!hasProjectConfig) {
                    const createConfig = await prompts.confirm({
                        message: `Create a navi.json configuration file in ${process.cwd()}?`,
                        initialValue: false,
                    })

                    if (createConfig && !prompts.isCancel(createConfig)) {
                        const defaultValue = {
                            $schema: "https://navi.ai/schema.json",
                        }
                        await Bun.write(projectConfigPath, JSON.stringify(defaultValue, null, 2))
                        prompts.log.success("Created navi.json")
                    }
                }

                prompts.note(
                    [
                        "Try running `navi` to start a chat.",
                        "Use `navi --help` to see all commands.",
                        "Use `navi models` to see available models.",
                    ].join("\n"),
                    "Next Steps",
                )

                prompts.outro("You are all set!")
            },
        })
    },
})



