import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { MemoryStore } from '../memory/store.js';
import { ContextLoader } from '../memory/context.js';

export interface AgentState {
  goal: string;
  messages: Array<{ role: string; content: string }>;
  steps: AgentStep[];
  stepCount: number;
  maxSteps: number;
  finished: boolean;
  finalResponse: string;
}

export interface AgentStep {
  thought: string;
  tool: string;
  args: unknown;
  result: unknown;
  timestamp: string;
}

export interface AgentRunResult {
  finalResponse: string;
  messages: Array<{ role: string; content: string }>;
  steps: AgentStep[];
}

export class AgentLoopHalt extends Error {
  constructor(public readonly response: string) {
    super(response);
    this.name = 'AgentLoopHalt';
  }
}

export interface AgentLoopDeps {
  llm?: LLMClient;
  tools?: ToolRegistry;
  memory?: MemoryStore;
  context?: ContextLoader;
  maxSteps?: number;
  executeTool?: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
}

export class AgentLoop {
  private llm: LLMClient;
  private tools: ToolRegistry;
  private memory: MemoryStore;
  private context: ContextLoader;
  private maxSteps: number;
  private executeTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>;

  constructor(deps: AgentLoopDeps = {}) {
    this.llm = deps.llm ?? new LLMClient();
    this.tools = deps.tools ?? new ToolRegistry();
    this.memory = deps.memory ?? new MemoryStore();
    this.context = deps.context ?? new ContextLoader();
    this.maxSteps = deps.maxSteps ?? 10;
    this.executeTool = deps.executeTool ?? ((tool, args) => this.tools.execute(tool, args));
  }

  async run(
    userInput: string,
    sessionHistory: Array<{ role: string; content: string }>,
    onStep: (step: AgentStep) => void,
  ): Promise<AgentRunResult> {
    const state: AgentState = {
      goal: userInput,
      messages: [...sessionHistory, { role: 'user', content: userInput }],
      steps: [],
      stepCount: 0,
      maxSteps: this.maxSteps,
      finished: false,
      finalResponse: '',
    };

    const ragContext = await this.context.load(userInput);
    if (ragContext) {
      state.messages.unshift({
        role: 'system',
        content: `User context:\n${ragContext}`,
      });
    }

    while (!state.finished && state.stepCount < state.maxSteps) {
      state.stepCount++;
      const llmResponse = await this.llm.chat(state.messages);

      if (llmResponse.response) {
        state.finished = true;
        state.finalResponse = llmResponse.response;
        break;
      }

      if (llmResponse.error) {
        state.finished = true;
        state.finalResponse = `Error from model: ${llmResponse.error}`;
        break;
      }

      if (llmResponse.tool) {
        const thought =
          typeof (llmResponse as Record<string, unknown>)['thought'] === 'string'
            ? String((llmResponse as Record<string, unknown>)['thought'])
            : '';

        const step: AgentStep = {
          thought,
          tool: llmResponse.tool,
          args: llmResponse.args ?? {},
          result: null,
          timestamp: new Date().toISOString(),
        };

        try {
          const result = await this.executeTool(llmResponse.tool, (llmResponse.args ?? {}) as Record<string, unknown>);
          step.result = result;
        } catch (err) {
          if (err instanceof AgentLoopHalt) {
            state.finished = true;
            state.finalResponse = err.response;
            break;
          }
          step.result = `Tool error (${llmResponse.tool}): ${err instanceof Error ? err.message : String(err)}`;
        }

        onStep(step);
        state.steps.push(step);

        state.messages.push({
          role: 'assistant',
          content: JSON.stringify({ tool: llmResponse.tool, args: llmResponse.args ?? {} }),
        });
        state.messages.push({
          role: 'user',
          content: `Tool result: ${JSON.stringify(step.result)}\n\nContinue working toward the goal: "${state.goal}"`,
        });

        continue;
      }

      state.finished = true;
      state.finalResponse = '(no response)';
    }

    if (!state.finished) {
      state.finalResponse =
        `I completed ${state.stepCount} steps toward your goal. Here's what I did:\n` +
        state.steps.map((s, i) => `${i + 1}. ${s.tool}: ${JSON.stringify(s.args)}`).join('\n');
    }

    await this.memory.save({
      goal: userInput,
      steps: state.steps,
      timestamp: new Date().toISOString(),
    });

    const normalizedMessages = state.messages.filter(
      (m) => !(m.role === 'system' && m.content.startsWith('User context:\n')),
    );

    return {
      finalResponse: state.finalResponse,
      messages: normalizedMessages,
      steps: state.steps,
    };
  }
}
