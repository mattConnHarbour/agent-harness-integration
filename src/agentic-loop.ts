import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import OpenAI from 'openai';
import { customToolDefinitions, customTools, type CustomToolName } from './custom-tools.js';
import { createSuperDocConnection } from './superdoc-client.js';
import { createSuperDocTools } from './superdoc-tools.js';

const MAX_TURNS = 8;
const ROOM_ID = 'agent-harness-demo';
const COLLABORATION_URL = process.env.COLLABORATION_URL ?? 'ws://127.0.0.1:1234';
const SAMPLE_DOCUMENT = fileURLToPath(new URL('../public/sample.docx', import.meta.url));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4000);

const superdocConnection = await createSuperDocConnection({
  document: SAMPLE_DOCUMENT,
  collaborationUrl: COLLABORATION_URL,
  roomId: ROOM_ID,
});
const superdocTools = await createSuperDocTools(superdocConnection.document);
const systemPrompt = `You are a contract-review agent working in a live document. Inspect the document before acting. Use the custom tools to identify supported clauses and consult the playbook when legal guidance is relevant. Use the SuperDoc tools to read or change the document. Make proposed wording changes as tracked edits and never accept or reject tracked changes.\n\n${superdocTools.systemPrompt}`;

type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

type GenericTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

function toOpenAITool(tool: unknown): OpenAI.Responses.FunctionTool {
  const generic = tool as GenericTool;
  return {
    type: 'function',
    name: generic.name,
    description: generic.description,
    parameters: generic.parameters,
    strict: false,
  };
}

async function dispatch(call: ToolCall): Promise<unknown> {
  if (superdocTools.ownsTool(call.name)) {
    return superdocTools.dispatch(call.name, call.args);
  }
  return customTools[call.name as CustomToolName](call.args as never);
}

async function runAgent(prompt: string) {
  const openai = new OpenAI();
  const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: prompt }];
  const results: Array<{ tool: string; result: unknown }> = [];
  const tools = [...superdocTools.tools, ...customToolDefinitions].map(toOpenAITool);

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      instructions: systemPrompt,
      input,
      tools,
      store: false,
    });

    input.push(...(response.output as unknown as OpenAI.Responses.ResponseInput));
    const toolCalls = response.output.filter((item) => item.type === 'function_call');
    if (toolCalls.length === 0) return { answer: response.output_text, results };

    for (const call of toolCalls) {
      let result: unknown;
      try {
        result = await dispatch({
          name: call.name as ToolCall['name'],
          args: JSON.parse(call.arguments) as Record<string, unknown>,
        });
      } catch (error) {
        result = { error: error instanceof Error ? error.message : String(error) };
      }

      results.push({ tool: call.name, result });
      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  throw new Error(`The agent exceeded the ${MAX_TURNS}-turn limit.`);
}

const app = Fastify();
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
});
app.get('/', async () => ({ status: 'ok' }));
app.post<{ Body: { prompt?: string } }>('/api/review', async (request, reply) => {
  const prompt = request.body?.prompt?.trim();
  if (!prompt) return reply.code(400).send({ error: 'A review prompt is required.' });
  return runAgent(prompt);
});

await app.listen({ host: HOST, port: PORT });

const stop = async () => {
  await app.close();
  await superdocConnection.close();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
