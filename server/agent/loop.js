// server/agent/loop.js — ReAct multi-step agent loop
import { LLMClient } from '../llm/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { MemoryStore } from '../memory/store.js';
import { ContextLoader } from '../memory/context.js';

export class AgentLoopHalt extends Error {
  constructor(response) {
    super(response);
    this.name = 'AgentLoopHalt';
    this.response = response;
  }
}

export class AgentLoop {
  constructor(deps = {}) {
    this.llm = deps.llm ?? new LLMClient();
    this.tools = deps.tools ?? new ToolRegistry();
    this.memory = deps.memory ?? new MemoryStore();
    this.context = deps.context ?? new ContextLoader();
    this.maxSteps = deps.maxSteps ?? 10;
    this.executeTool = deps.executeTool ?? ((tool, args) => this.tools.execute(tool, args));
  }

  async run(userInput, sessionHistory = [], onStep = () => {}) {
    const state = {
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

    const VERIFY_TOOLS = new Set(['listFiles', 'findFile', 'readFile']);
    const MUTATING_TOOLS = new Set([
      'createDirectory',
      'createFile',
      'writeFile',
      'renameFile',
      'moveFile',
      'deleteFile',
      'organiseByRule',
    ]);

    const hasUnverifiedMutatingWork = () => {
      for (let i = state.steps.length - 1; i >= 0; i--) {
        const stepTool = state.steps[i]?.tool;
        if (VERIFY_TOOLS.has(stepTool)) return false;
        if (MUTATING_TOOLS.has(stepTool)) return true;
      }
      return false;
    };

    while (!state.finished && state.stepCount < state.maxSteps) {
      state.stepCount++;
      const llmResponse = await this.llm.chat(state.messages);

      if (llmResponse.response) {
        if (hasUnverifiedMutatingWork()) {
          state.messages.push({
            role: 'assistant',
            content: JSON.stringify({ response: llmResponse.response }),
          });
          state.messages.push({
            role: 'user',
            content:
              'Do not finish yet. Verify the result of your most recent write/move/create/delete action using an appropriate read-only tool (readFile, listFiles, or findFile), then continue. Only return {"response":"..."} after verification succeeds.',
          });
          continue;
        }

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
          typeof llmResponse.thought === 'string'
            ? String(llmResponse.thought)
            : '';

        const step = {
          thought,
          tool: llmResponse.tool,
          args: llmResponse.args ?? {},
          result: null,
          success: true,
          timestamp: new Date().toISOString(),
        };

        try {
          const result = await this.executeTool(llmResponse.tool, llmResponse.args ?? {});
          step.result = result;
        } catch (err) {
          step.success = false;
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
