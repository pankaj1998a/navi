/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type z } from 'zod';
import { coreEvents, CoreEvent } from '../util/events.ts';
import { debugLogger } from '../util/debugLogger.ts';
import { isPreviewModel, isAutoModel } from '../config/models.ts';
import { DEFAULT_GEMINI_MODEL, GEMINI_MODEL_ALIAS_AUTO, PREVIEW_GEMINI_FLASH_MODEL } from '../config/models.ts';
import { ModelConfigService, type ModelConfig } from '../services/modelConfigService.ts';
import { DELEGATE_TO_AGENT_TOOL_NAME } from '../tools/tool-names.ts';
import type { AgentDefinition, LocalAgentDefinition, AgentOverride } from './types.ts';
import type { Config } from '../config/config.ts';
import { loadAgentsFromDirectory } from './agent-loader.ts';
import { Storage } from '../config/storage.ts';

export interface RemoteAgentLoader {
  loadAgent(name: string, url: string): Promise<{ description: string }>;
  clearCache(): void;
}

/**
 * Returns the model config alias for a given agent definition.
 */
export function getModelConfigAlias<TOutput extends z.ZodTypeAny>(
  definition: AgentDefinition<TOutput>,
): string {
  return `${definition.name}-config`;
}

/**
 * Manages the discovery, loading, validation, and registration of
 * AgentDefinitions.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition<any>>();
  private remoteAgentLoader?: RemoteAgentLoader;

  constructor(private readonly config: Config) {}

  setRemoteAgentLoader(loader: RemoteAgentLoader) {
    this.remoteAgentLoader = loader;
  }

  /**
   * Discovers and loads agents.
   */
  async initialize(): Promise<void> {
    coreEvents.on(CoreEvent.ModelChanged, this.onModelChanged);

    await this.loadAgents();
  }

  private onModelChanged = () => {
    this.refreshAgents().catch((e) => {
      debugLogger.error(
        '[AgentRegistry] Failed to refresh agents on model change:',
        e,
      );
    });
  };

  /**
   * Clears the current registry and re-scans for agents.
   */
  async reload(): Promise<void> {
    this.remoteAgentLoader?.clearCache();
    await (this.config as any).reloadAgents?.(); // Hack for circular reload
    this.agents.clear();
    await this.loadAgents();
    coreEvents.emitAgentsRefreshed();
  }

  /**
   * Disposes of resources and removes event listeners.
   */
  dispose(): void {
    coreEvents.off(CoreEvent.ModelChanged, this.onModelChanged);
  }

  private async loadAgents(): Promise<void> {
    // Built-in agents should be registered by the caller or specialized method
    
    if (!this.config.isAgentsEnabled()) {
      return;
    }

    // Load user-level agents: ~/.gemini/agents/
    const userAgentsDir = Storage.getUserAgentsDir();
    const userAgents = await loadAgentsFromDirectory(userAgentsDir);
    for (const error of userAgents.errors) {
      debugLogger.warn(
        `[AgentRegistry] Error loading user agent: ${error.message}`,
      );
      coreEvents.emitFeedback('error', `Agent loading error: ${error.message}`);
    }
    await Promise.allSettled(
      userAgents.agents.map((agent) => this.registerAgent(agent)),
    );

    // Load project-level agents: .gemini/agents/ (relative to Project Root)
    const folderTrustEnabled = this.config.getFolderTrust();
    const isTrustedFolder = this.config.isTrustedFolder();

    if (!folderTrustEnabled || isTrustedFolder) {
      const projectAgentsDir = (this.config.storage as any).getProjectAgentsDir();
      const projectAgents = await loadAgentsFromDirectory(projectAgentsDir);
      for (const error of projectAgents.errors) {
        coreEvents.emitFeedback(
          'error',
          `Agent loading error: ${error.message}`,
        );
      }
      await Promise.allSettled(
        projectAgents.agents.map((agent) => this.registerAgent(agent)),
      );
    } else {
      coreEvents.emitFeedback(
        'info',
        'Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.',
      );
    }

    // Load agents from extensions
    for (const extension of this.config.getExtensions()) {
      if (extension.isActive && extension.agents) {
        await Promise.allSettled(
          extension.agents.map((agent) => this.registerAgent(agent)),
        );
      }
    }

    if (this.config.getDebugMode()) {
      debugLogger.log(
        `[AgentRegistry] Loaded with ${this.agents.size} agents.`,
      );
    }
  }

  async refreshAgents(): Promise<void> {
    // Built-in agents should be re-saved by the caller if needed
    await Promise.allSettled(
      Array.from(this.agents.values()).map((agent) =>
        this.registerAgent(agent),
      ),
    );
  }

  /**
   * Registers an agent definition. If an agent with the same name exists,
   * it will be overwritten, respecting the precedence established by the
   * initialization order.
   */
  async registerAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): Promise<void> {
    if (definition.kind === 'local') {
      this.registerLocalAgent(definition);
    } else if (definition.kind === 'remote') {
      await this.registerRemoteAgent(definition);
    }
  }

  /**
   * Registers a local agent definition synchronously.
   */
  registerLocalAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): void {
    if (definition.kind !== 'local') {
      return;
    }

    // Basic validation
    if (!definition.name || !definition.description) {
      debugLogger.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    const settingsOverrides =
      this.config.getAgentsSettings().overrides?.[definition.name];

    if (!this.isAgentEnabled(definition, settingsOverrides)) {
      if (this.config.getDebugMode()) {
        debugLogger.log(
          `[AgentRegistry] Skipping disabled agent '${definition.name}'`,
        );
      }
      return;
    }

    if (this.agents.has(definition.name) && this.config.getDebugMode()) {
      debugLogger.log(`[AgentRegistry] Overriding agent '${definition.name}'`);
    }

    const mergedDefinition = this.applyOverrides(definition, settingsOverrides);
    this.agents.set(mergedDefinition.name, mergedDefinition);

    this.registerModelConfigs(mergedDefinition);
  }

  private isAgentEnabled<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
    overrides?: AgentOverride,
  ): boolean {
    const isExperimental = definition.experimental === true;
    let isEnabled = !isExperimental;

    if (overrides) {
      if (overrides.disabled !== undefined) {
        isEnabled = !overrides.disabled;
      } else if (overrides.enabled !== undefined) {
        isEnabled = overrides.enabled;
      }
    }

    return isEnabled;
  }

  /**
   * Registers a remote agent definition asynchronously.
   */
  protected async registerRemoteAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): Promise<void> {
    if (definition.kind !== 'remote') {
      return;
    }

    // Basic validation
    if (!definition.name || !definition.description) {
      debugLogger.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    const overrides =
      this.config.getAgentsSettings().overrides?.[definition.name];

    if (!this.isAgentEnabled(definition, overrides)) {
      if (this.config.getDebugMode()) {
        debugLogger.log(
          `[AgentRegistry] Skipping disabled remote agent '${definition.name}'`,
        );
      }
      return;
    }

    if (this.agents.has(definition.name) && this.config.getDebugMode()) {
      debugLogger.log(`[AgentRegistry] Overriding agent '${definition.name}'`);
    }

    if (!this.remoteAgentLoader) {
      debugLogger.warn(`[AgentRegistry] No remote agent loader set. Cannot register remote agent '${definition.name}'`);
      return;
    }

    try {
      const result = await this.remoteAgentLoader.loadAgent(definition.name, (definition as any).agentCardUrl);
      definition.description = result.description;
      
      if (this.config.getDebugMode()) {
        debugLogger.log(
          `[AgentRegistry] Registered remote agent '${definition.name}'`,
        );
      }
      this.agents.set(definition.name, definition);
    } catch (e) {
      debugLogger.warn(
        `[AgentRegistry] Error loading A2A agent "${definition.name}":`,
        e,
      );
    }
  }

  private applyOverrides<TOutput extends z.ZodTypeAny>(
    definition: LocalAgentDefinition<TOutput>,
    overrides?: AgentOverride,
  ): LocalAgentDefinition<TOutput> {
    if (definition.kind !== 'local' || !overrides) {
      return definition;
    }

    // Use Object.create to preserve lazy getters on the definition object
    const merged: LocalAgentDefinition<TOutput> = Object.create(definition);

    if (overrides.runConfig) {
      merged.runConfig = {
        ...definition.runConfig,
        ...overrides.runConfig,
      };
    }

    if (overrides.modelConfig) {
      merged.modelConfig = ModelConfigService.merge(
        definition.modelConfig,
        overrides.modelConfig,
      );
    }

    return merged;
  }

  private registerModelConfigs<TOutput extends z.ZodTypeAny>(
    definition: LocalAgentDefinition<TOutput>,
  ): void {
    const modelConfig = definition.modelConfig;
    let model = modelConfig.model;
    if (model === 'inherit') {
      model = this.config.getModel();
    }

    const agentModelConfig: ModelConfig = {
      ...modelConfig,
      model,
    };

    this.config.modelConfigService.registerRuntimeModelConfig(
      getModelConfigAlias(definition),
      {
        modelConfig: agentModelConfig,
      },
    );

    if (agentModelConfig.model && isAutoModel(agentModelConfig.model)) {
      this.config.modelConfigService.registerRuntimeModelOverride({
        match: {
          overrideScope: definition.name,
        },
        modelConfig: {
          generateContentConfig: agentModelConfig.generateContentConfig,
        },
      });
    }
  }

  /**
   * Retrieves an agent definition by name.
   */
  getDefinition(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Returns a list of all registered agent names.
   */
  getAllAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Generates a description for the delegate_to_agent tool.
   * Unlike getDirectoryContext() which is for system prompts,
   * this is formatted for tool descriptions.
   */
  getToolDescription(): string {
    if (this.agents.size === 0) {
      return 'Delegates a task to a specialized sub-agent. No agents are currently available.';
    }

    const agentDescriptions = Array.from(this.agents.entries())
      .map(([name, def]) => `- **${name}**: ${def.description}`)
      .join('\n');

    return `Delegates a task to a specialized sub-agent.\n\nAvailable agents:\n${agentDescriptions}`;
  }

  /**
   * Generates a markdown "Phone Book" of available agents and their schemas.
   * This MUST be injected into the System Prompt of the parent agent.
   */
  getDirectoryContext(): string {
    if (this.agents.size === 0) {
      return 'No sub-agents are currently available.';
    }

    let context = '## Available Sub-Agents\n';
    context += `Sub-agents are specialized expert agents that you can use to assist you in
      the completion of all or part of a task.

      ALWAYS use \`${DELEGATE_TO_AGENT_TOOL_NAME}\` to delegate to a subagent if one
      exists that has expertise relevant to your task.

      For example:
      - Prompt: 'Fix test', Description: 'An agent with expertise in fixing tests.' -> should use the sub-agent.
      - Prompt: 'Update the license header', Description: 'An agent with expertise in licensing and copyright.' -> should use the sub-agent.
      - Prompt: 'Diagram the architecture of the codebase', Description: 'Agent with architecture experience'. -> should use the sub-agent.
      - Prompt: 'Implement a fix for [bug]' -> Should decompose the project into subtasks, which may utilize available agents like 'plan', 'validate', and 'fix-tests'.

      The following are the available sub-agents:\n\n`;

    for (const [name, def] of this.agents) {
      context += `- **${name}**: ${def.description}\n`;
    }
    return context;
  }
}
