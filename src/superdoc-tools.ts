import { createAgentToolkit, type SuperDocDocument } from '@superdoc/sdk';

// Adapts SuperDoc's package-provided toolkit to the existing harness's dispatch shape.
export async function createSuperDocTools(document: SuperDocDocument) {
  // The package supplies the prompt, tool schemas, and dispatcher as one compatible set.
  const toolkit = await createAgentToolkit({
    provider: 'generic',
    preset: 'core',
    excludeActions: ['accept_tracked_changes', 'reject_tracked_changes'],
  });

  // Derive ownership from the package definitions instead of duplicating tool names here.
  const toolNames = new Set(
    toolkit.tools.flatMap((tool) => {
      const name = (tool as { name?: unknown }).name;
      return typeof name === 'string' ? [name] : [];
    }),
  );

  return {
    tools: toolkit.tools,
    systemPrompt: toolkit.systemPrompt,
    ownsTool: (name: string) => toolNames.has(name),
    // Keep SuperDoc dispatch isolated from the harness's existing custom-tool dispatch.
    dispatch: (name: string, args: Record<string, unknown>) => toolkit.dispatch(document, name, args),
  };
}
