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
    const collaboration = {
      providerType: 'hocuspocus' as const,
      url: options.collaborationUrl,
      documentId: options.roomId,
    };
    let document;
    try {
      document = await client.open({
        doc: options.document,
        collaboration: { ...collaboration, roomMode: 'create' },
      });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== 'COLLABORATION_ROOM_ALREADY_EXISTS') throw error;
      document = await client.open({
        collaboration: { ...collaboration, roomMode: 'join' },
      });
    }

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
