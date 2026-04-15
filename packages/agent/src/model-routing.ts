import { ModelConfig, Route } from "./types";

export interface RouteConfig {
  enabled: boolean;
  cheapModel: ModelConfig;
  strongModel: ModelConfig;
  maxSimpleChars: number;
  maxSimpleWords: number;
}

const COMPLEXITY_KEYWORDS = [
  "debug",
  "debugging",
  "implement",
  "refactor",
  "patch",
  "traceback",
  "exception",
  "error",
  "analyze",
  "investigation",
  "architecture",
  "compare",
  "benchmark",
  "optimize",
  "review",
  "terminal",
  "shell",
  "pytest",
  "test",
  "plan",
  "delegate",
  "subagent",
  "cron",
  "docker",
];

/**
 * Smart model routing logic.
 * Decides whether to use a cheap or strong model based on the complexity 
 * of the user message.
 */
export class ModelRouter {
  /**
   * Choose the appropriate route for a given user message.
   */
  static chooseRoute(userMessage: string, config: RouteConfig): Route {
    if (!config.enabled) {
      return {
        model: config.strongModel,
        reason: "Routing disabled, defaulting to strong model",
      };
    }

    const lowerMessage = userMessage.toLowerCase();
    
    // Check for complexity keywords
    for (const keyword of COMPLEXITY_KEYWORDS) {
      if (lowerMessage.includes(keyword)) {
        return {
          model: config.strongModel,
          reason: `Complexity keyword '${keyword}' detected`,
        };
      }
    }

    // Check message length
    if (userMessage.length > config.maxSimpleChars) {
      return {
        model: config.strongModel,
        reason: `Message length (${userMessage.length}) exceeds simple threshold (${config.maxSimpleChars})`,
      };
    }

    // Check word count
    const wordCount = userMessage.trim().split(/\s+/).length;
    if (wordCount > config.maxSimpleWords) {
      return {
        model: config.strongModel,
        reason: `Word count (${wordCount}) exceeds simple threshold (${config.maxSimpleWords})`,
      };
    }

    // Default to cheap model for simple tasks
    return {
      model: config.cheapModel,
      reason: "Task appears simple enough for cheap model",
    };
  }
}
