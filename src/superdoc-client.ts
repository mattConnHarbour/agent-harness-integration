import { createSuperDocClient } from '@superdoc/sdk';

type SuperDocConnectionOptions = {
  document: string;
  collaborationUrl: string;
  roomId: string;
};

// Opens the agent's connection to the same collaboration room as the browser.
export async function createSuperDocConnection(options: SuperDocConnectionOptions) {
  const client = createSuperDocClient({
    user: { name: 'Contract review agent', email: 'review-agent@example.com' },
  });

  try {
    await client.connect();
    const document = await client.open({
      doc: options.document,
      collaboration: {
        providerType: 'hocuspocus',
        url: options.collaborationUrl,
        documentId: options.roomId,
        roomMode: 'create',
      },
    });

    return {
      document,
      close: async () => {
        await document.close({ discard: true }).catch(() => {});
        await client.dispose().catch(() => {});
      },
    };
  } catch (error) {
    // A partial setup may still have allocated client resources.
    await client.dispose().catch(() => {});
    throw error;
  }
}
