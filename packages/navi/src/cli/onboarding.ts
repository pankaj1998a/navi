import { Auth } from "../auth";
import { Config } from "../config/config";
import { ModelsDev } from "../provider/models";
import { UI } from "./ui";
import * as prompts from "@clack/prompts";
import { AuthLoginCommand } from "./cmd/auth";
import { Global } from "../global";
import path from "path";
import { EOL } from "os";

export namespace Onboarding {
    export async function checkAndRun() {
        // 1. Check if first run ever (by checking if config/auth exists or some marker)
        // We'll trust auth.json presence or env vars.

        const providers = await ModelsDev.get();
        const configuredAuth = await Auth.all();

        // Check for any configured auth in auth.json
        const hasConfiguredAuth = Object.keys(configuredAuth).length > 0;

        // Check for environment variables
        let hasEnvAuth = false;
        for (const provider of Object.values(providers)) {
            for (const envVar of provider.env) {
                if (process.env[envVar]) {
                    hasEnvAuth = true;
                    break;
                }
            }
            if (hasEnvAuth) break;
        }

        if (hasConfiguredAuth || hasEnvAuth) {
            return;
        }

        // No auth found. Start onboarding.
        UI.println(UI.logo());
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "Welcome to Navi!" + UI.Style.TEXT_NORMAL);
        UI.println("It looks like you haven't configured any AI providers yet.");
        UI.println("Let's get you set up.");
        UI.println();

        const options = [
            {
                label: "Log in with a provider",
                value: "login",
                hint: "Anthropic, OpenAI, Gemini, etc.",
            },
            {
                label: "I have environment variables set (skip)",
                value: "skip",
            },
            {
                label: "Exit",
                value: "exit",
            },
        ];

        const choice = await prompts.select({
            message: "What would you like to do?",
            options,
        });

        if (prompts.isCancel(choice) || choice === "exit") {
            process.exit(0);
        }

        if (choice === "skip") {
            return;
        }

        if (choice === "login") {
            // Invoke auth login
            await AuthLoginCommand.handler({
                _: ["auth", "login"],
                $0: "navi",
                url: undefined
            } as any);

            // Re-check
            const newAuth = await Auth.all();
            if (Object.keys(newAuth).length > 0) {
                UI.println();
                UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Setup complete! You can now start using Navi." + UI.Style.TEXT_NORMAL);
                UI.println(`Try running: ${UI.Style.TEXT_HIGHLIGHT}navi "Explain this project"${UI.Style.TEXT_NORMAL}`);
                return;
            }
        }
    }
}
