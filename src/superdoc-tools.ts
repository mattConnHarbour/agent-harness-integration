import { fileURLToPath } from 'node:url';
import { createAgentToolkit, createSuperDocClient } from '@superdoc/sdk';

const ROOM_ID = 'agent-harness-demo';
const COLLABORATION_URL = process.env.COLLABORATION_URL ?? 'ws://127.0.0.1:1234';
const SAMPLE_DOCUMENT = fileURLToPath(new URL('../public/sample.docx', import.meta.url));
export type SuperDocToolName = 'superdoc_inspect' | 'superdoc_perform_action';
const superdocToolNames = new Set<string>(['superdoc_inspect', 'superdoc_perform_action']);

const client = createSuperDocClient({
  user: { name: 'Contract review agent', email: 'review-agent@example.com' },
});
await client.connect();

const document = await client.open({
  doc: SAMPLE_DOCUMENT,
  collaboration: {
    providerType: 'hocuspocus',
    url: COLLABORATION_URL,
    documentId: ROOM_ID,
    roomMode: 'create',
  },
});

const toolkit = await createAgentToolkit({
  provider: 'generic',
  preset: 'core',
  excludeActions: ['accept_tracked_changes', 'reject_tracked_changes'],
});

export const superdocTools = toolkit.tools;
export const superdocSystemPrompt = toolkit.systemPrompt;

export function isSuperDocTool(name: string): boolean {
  return superdocToolNames.has(name);
}

export function dispatchSuperDocTool(name: string, args: Record<string, unknown>) {
  return toolkit.dispatch(document, name, args);
}

export async function closeSuperDoc() {
  await document.close({ discard: true }).catch(() => {});
  await client.dispose().catch(() => {});
}
