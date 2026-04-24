/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  BaseDeclarativeTool,
  Kind,
  type ToolInvocation,
  type ToolResult,
  BaseToolInvocation,
  type ToolCallConfirmationDetails,
} from './tools.ts';
import type { AnsiOutput } from '../util/terminalSerializer.ts';
import { DELEGATE_TO_AGENT_TOOL_NAME } from './tool-names.ts';
import type { AgentRegistry } from '../agents/index.ts';
import type { Config } from '../config/config.ts';
import type { MessageBus } from '../confirmation-bus/index.ts';
import type { AgentDefinition, AgentInputs } from '../agents/index.ts';
import { SubagentToolWrapper } from './subagent-tool-wrapper.ts';

type DelegateParams = { agent_name: string } & Record<string, unknown>;

export class DelegateToAgentTool extends BaseDeclarativeTool<
  DelegateParams,
  ToolResult
> {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    const definitions = registry.getAllDefinitions();

    let schema: z.ZodTypeAny;

    if (definitions.length === 0) {
      // Fallback if no agents are registered (mostly for testing/safety)
      schema = z.object({
        agent_name: z.string().describe('No agents are currently available.'),
      });
    } else {
      const agentSchemas = definitions.map((def) => {
        const inputShape: Record<string, z.ZodTypeAny> = {
          agent_name: z.literal(def.name).describe(def.description),
        };

        for (const [key, inputDef] of Object.entries(def.inputConfig.inputs)) {
          if (key === 'agent_name') {
            throw new Error(
              `Agent '${def.name}' cannot have an input parameter named 'agent_name' as it is a reserved parameter for delegation.`,
            );
          }

          let validator: z.ZodTypeAny;

          // Map input types to Zod
          switch (inputDef.type) {
            case 'string':
              validator = z.string();
              break;
            case 'number':
              validator = z.number();
              break;
            case 'boolean':
              validator = z.boolean();
              break;
            case 'integer':
              validator = z.number().int();
              break;
            case 'string[]':
              validator = z.array(z.string());
              break;
            case 'number[]':
              validator = z.array(z.number());
              break;
            default: {
              // This provides compile-time exhaustiveness checking.
              const _exhaustiveCheck: never = inputDef.type;
              void _exhaustiveCheck;
              throw new Error(`Unhandled agent input type: '${inputDef.type}'`);
            }
          }

          if (!inputDef.required) {
            validator = validator.optional();
          }

          inputShape[key] = validator.describe(inputDef.description);
        }

        // Cast required because Zod can't infer the discriminator from dynamic keys
        return z.object(
          inputShape,
        ) as any;
      });

      // Create the discriminated union
      // z.discriminatedUnion requires at least 2 options, so we handle the single agent case
      if (agentSchemas.length === 1) {
        schema = agentSchemas[0];
      } else {
        schema = z.discriminatedUnion(
          'agent_name',
          agentSchemas as [
            any,
            any,
            ...Array<any>,
          ],
        );
      }
    }

    super(
      DELEGATE_TO_AGENT_TOOL_NAME,
      'Delegate to Agent',
      registry.getToolDescription(),
      Kind.Think,
      zodToJsonSchema(schema),
      messageBus,
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ true,
    );
  }

  protected createInvocation(
    params: DelegateParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<DelegateParams, ToolResult> {
    return new DelegateInvocation(
      params,
      this.registry,
      this.config,
      messageBus,
      _toolName,
      _toolDisplayName,
      _kind,
      this.config.getWorkspaceContext().getDirectories(),
    );
  }
}

class DelegateInvocation extends BaseToolInvocation<
  DelegateParams,
  ToolResult
> {
  constructor(
    params: DelegateParams,
    private readonly registry: AgentRegistry,
    private readonly config: Config,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(
      params,
      messageBus,
      _toolName ?? DELEGATE_TO_AGENT_TOOL_NAME,
      _toolDisplayName,
      undefined,
      _kind,
      _workspaceRoots,
    );
  }

  getDescription(): string {
    return `Delegating to agent '${this.params.agent_name}'`;
  }

  override async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const definition = this.registry.getDefinition(this.params.agent_name);
    if (!definition || definition.kind !== 'remote') {
      // Local agents should execute without confirmation. Inner tool calls will bubble up their own confirmations to the user.
      return false;
    }

    const { agent_name: _agent_name, ...agentArgs } = this.params;
    const invocation = this.buildSubInvocation(
      definition,
      agentArgs as AgentInputs,
    );
    return invocation.shouldConfirmExecute(abortSignal);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<ToolResult> {
    const definition = this.registry.getDefinition(this.params.agent_name);
    if (!definition) {
      throw new Error(
        `Agent '${this.params.agent_name}' not found in registry.`,
      );
    }

    const { agent_name: _agent_name, ...agentArgs } = this.params;
    const invocation = this.buildSubInvocation(
      definition,
      agentArgs as AgentInputs,
    );

    return invocation.execute(signal, updateOutput);
  }

  private buildSubInvocation(
    definition: AgentDefinition,
    agentArgs: AgentInputs,
  ): ToolInvocation<AgentInputs, ToolResult> {
    const wrapper = new SubagentToolWrapper(
      definition,
      this.config,
      this.messageBus,
    );

    return wrapper.build(agentArgs);
  }
}

