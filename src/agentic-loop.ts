import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import OpenAI from 'openai';
import { customToolDefinitions, customTools, type CustomToolName } from './custom-tools.js';
import { createSuperDocConnection } from './superdoc-client.js';
import { createSuperDocTools } from './superdoc-tools.js';

const MAX_TURNS = 15;
const ROOM_ID = process.env.DOCUMENT_ROOM_ID ?? 'agent-harness-demo';
const COLLABORATION_URL = process.env.COLLABORATION_URL ?? 'ws://127.0.0.1:1234';
const SAMPLE_DOCUMENT = fileURLToPath(new URL('../public/sample.docx', import.meta.url));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4000);

type AgentSession = {
  connection: Awaited<ReturnType<typeof createSuperDocConnection>>;
  tools: Awaited<ReturnType<typeof createSuperDocTools>>;
  systemPrompt: string;
  cleanup?: () => Promise<void>;
};

const sessions = new Map<string, AgentSession>();

async function createAgentSession(document: string, roomId: string, cleanup?: () => Promise<void>) {
  const connection = await createSuperDocConnection({
    document,
    collaborationUrl: COLLABORATION_URL,
    roomId,
  });
  const tools = await createSuperDocTools(connection.document);
  const systemPrompt = `You are a contract-review agent working in a live document. Inspect the document before acting. Use the custom tools to identify supported clauses and consult the playbook when legal guidance is relevant. Use the SuperDoc tools to read or change the document. Make proposed wording changes as tracked edits and never accept or reject tracked changes.\n\n${tools.systemPrompt}`;
  return { connection, tools, systemPrompt, cleanup };
}

sessions.set(ROOM_ID, await createAgentSession(SAMPLE_DOCUMENT, ROOM_ID));

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

async function dispatch(session: AgentSession, call: ToolCall): Promise<unknown> {
  if (session.tools.ownsTool(call.name)) {
    return session.tools.dispatch(call.name, call.args);
  }
  return customTools[call.name as CustomToolName](call.args as never);
}

async function runAgent(session: AgentSession, prompt: string) {
  const openai = new OpenAI();
  const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: prompt }];
  const results: Array<{ tool: string; result: unknown }> = [];
  const tools = [...session.tools.tools, ...customToolDefinitions].map(toOpenAITool);

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
      instructions: session.systemPrompt,
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
        result = await dispatch(session, {
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

  const finalResponse = await openai.responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
    instructions: `${session.systemPrompt}\n\nThe tool-execution limit has been reached. Do not call more tools. Briefly summarize the work completed and clearly identify anything that remains unfinished.`,
    input,
    store: false,
  });

  return { answer: finalResponse.output_text, results };
}

const app = Fastify();
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
});
await app.register(multipart, {
  limits: { files: 1, fileSize: 20 * 1024 * 1024 },
});
app.get('/', async () => ({ status: 'ok' }));
app.post('/api/document', async (request, reply) => {
  const upload = await request.file();
  if (!upload || !upload.filename.toLowerCase().endsWith('.docx')) {
    return reply.code(400).send({ error: 'Upload a DOCX document.' });
  }

  const uploadDirectory = await mkdtemp(join(tmpdir(), 'agent-harness-'));
  const documentPath = join(uploadDirectory, 'document.docx');
  try {
    await writeFile(documentPath, await upload.toBuffer());
    const roomId = `agent-harness-${crypto.randomUUID()}`;
    const session = await createAgentSession(
      documentPath,
      roomId,
      () => rm(uploadDirectory, { recursive: true, force: true }),
    );
    sessions.set(roomId, session);
    return { roomId, filename: upload.filename };
  } catch (error) {
    await rm(uploadDirectory, { recursive: true, force: true });
    throw error;
  }
});
app.post<{ Body: { prompt?: string; roomId?: string } }>('/api/review', async (request, reply) => {
  const prompt = request.body?.prompt?.trim();
  if (!prompt) return reply.code(400).send({ error: 'A review prompt is required.' });
  const session = sessions.get(request.body?.roomId ?? ROOM_ID);
  if (!session) return reply.code(404).send({ error: 'The document session was not found.' });
  return runAgent(session, prompt);
});

await app.listen({ host: HOST, port: PORT });

const stop = async () => {
  await app.close();
  await Promise.all(
    [...sessions.values()].map(async (session) => {
      await session.connection.close();
      await session.cleanup?.();
    }),
  );
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
