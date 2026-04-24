/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.ts';
import type { Config } from '../config/config.ts';
import type { AgentDefinition, AgentInputs } from '../agents/index.ts';
import { convertInputConfigToJsonSchema } from './schema-utils.ts';
import { LocalSubagentInvocation } from './local-invocation.ts';
import { RemoteAgentInvocation } from './remote-invocation.ts';
import type { MessageBus } from '../confirmation-bus/index.ts';

/**
 * A tool wrapper that dynamically exposes a subagent as a standard,
 * strongly-typed `DeclarativeTool`.
 */
export class SubagentToolWrapper extends BaseDeclarativeTool<
  AgentInputs,
  ToolResult
> {
  /**
   * Constructs the tool wrapper.
   *
   * The constructor dynamically generates the JSON schema for the tool's
   * parameters based on the subagent's input configuration.
   *
   * @param definition The `AgentDefinition` of the subagent to wrap.
   * @param config The runtime configuration, passed down to the subagent.
   * @param messageBus Optional message bus for policy enforcement.
   */
  constructor(
    private readonly definition: AgentDefinition,
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    const parameterSchema = convertInputConfigToJsonSchema(
      definition.inputConfig,
    );

    super(
      definition.name,
      definition.displayName ?? definition.name,
      definition.description,
      Kind.Think,
      parameterSchema,
      messageBus,
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ true,
    );
  }

  /**
   * Creates an invocation instance for executing the subagent.
   *
   * This method is called by the tool framework when the parent agent decides
   * to use this tool.
   *
   * @param params The validated input parameters from the parent agent's call.
   * @returns A `ToolInvocation` instance ready for execution.
   */
  protected createInvocation(
    params: AgentInputs,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<AgentInputs, ToolResult> {
    const definition = this.definition;
    const effectiveMessageBus = messageBus;

    if (definition.kind === 'remote') {
      return new RemoteAgentInvocation(
        definition,
        params,
        effectiveMessageBus,
        _toolName,
        _toolDisplayName,
      );
    }

    return new LocalSubagentInvocation(
      definition,
      this.config,
      params,
      effectiveMessageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}

