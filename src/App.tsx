import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

type Status = 'connecting' | 'uploading' | 'ready' | 'reviewing' | 'complete' | 'error';

type ActiveDocument = {
  data: Blob;
  filename: string;
  roomId: string;
};

type ReviewResponse = {
  answer: string;
  results: Array<{ tool: string }>;
};

const statusLabels: Record<Status, string> = {
  connecting: 'Connecting',
  uploading: 'Uploading',
  ready: 'Ready',
  reviewing: 'Reviewing',
  complete: 'Review complete',
  error: 'Something went wrong',
};

const API_URL = import.meta.env.VITE_API_URL ?? '';
const COLLABORATION_URL = import.meta.env.VITE_COLLABORATION_URL ?? 'ws://127.0.0.1:1234';

function toolLabel(tool: string) {
  return `${toolSource(tool)}: ${tool}`;
}

function toolSource(tool: string) {
  return tool.startsWith('superdoc_') ? 'superdoc' : 'custom';
}

function setRoomQuery(roomId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);
}

export default function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [tools, setTools] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(
    'Identify the termination clause and make it red. Then update the language to reflect our playbook.',
  );
  const [answer, setAnswer] = useState('');
  const [activeDocument, setActiveDocument] = useState<ActiveDocument>();

  useEffect(() => {
    let active = true;

    async function initializeDocumentSession() {
      const requestedRoomId = new URLSearchParams(window.location.search).get('room') ?? undefined;
      const sessionResponse = await fetch(`${API_URL}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId: requestedRoomId }),
      });
      if (!sessionResponse.ok) throw new Error(await sessionResponse.text());
      const session = (await sessionResponse.json()) as { roomId: string };
      setRoomQuery(session.roomId);

      const response = await fetch('/sample.docx');
      if (!response.ok) throw new Error(`The sample document returned ${response.status}.`);
      const data = await response.blob();
      if (active) setActiveDocument({ data, filename: 'Mutual NDA.docx', roomId: session.roomId });
    }

    void initializeDocumentSession().catch((error) => {
      console.error(error);
      if (active) setStatus('error');
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || !activeDocument) return;
    const editor = editorRef.current;
    const currentDocument = activeDocument;
    let active = true;
    let superdoc: SuperDoc | undefined;

    setStatus('connecting');

    async function openDocument() {
      superdoc = new SuperDoc({
        selector: editor,
        documents: [
          {
            id: currentDocument.roomId,
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data: currentDocument.data,
            v2Collaboration: {
              providerType: 'hocuspocus',
              documentId: currentDocument.roomId,
              serverUrl: COLLABORATION_URL,
            },
          },
        ],
        user: { name: 'Browser reviewer', email: 'reviewer@example.com' },
        onCollaborationReady: () => active && setStatus('ready'),
        onException: ({ error }) => {
          console.error(error);
          if (active) setStatus('error');
        },
      });
    }

    void openDocument().catch((error) => {
      console.error(error);
      if (active) setStatus('error');
    });

    return () => {
      active = false;
      superdoc?.destroy();
    };
  }, [activeDocument]);

  async function uploadDocument(file: File) {
    setStatus('uploading');
    setTools([]);
    setAnswer('');
    try {
      const body = new FormData();
      body.append('document', file);
      const response = await fetch(`${API_URL}/api/document`, { method: 'POST', body });
      if (!response.ok) throw new Error(await response.text());
      const uploaded = (await response.json()) as { roomId: string; filename: string };
      setRoomQuery(uploaded.roomId);
      setActiveDocument({ data: file, filename: uploaded.filename, roomId: uploaded.roomId });
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  }

  async function runReview() {
    setStatus('reviewing');
    setTools([]);
    setAnswer('');
    try {
      const response = await fetch(`${API_URL}/api/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, roomId: activeDocument?.roomId }),
      });
      if (!response.ok) throw new Error(await response.text());
      const review = (await response.json()) as ReviewResponse;
      setTools(review.results.map(({ tool }) => tool));
      setAnswer(review.answer);
      setStatus('complete');
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  }

  const canReview = status === 'ready' || status === 'complete';

  return (
    <main>
      <header>
        <div className="brand"><span>S</span> SuperDoc</div>
        <div className={`status status-${status}`}><i />{statusLabels[status]}</div>
      </header>

      <section className="intro">
        <p>EXTERNAL AGENT DEMO</p>
        <h1>Review a shared document</h1>
        <span>The browser and the server-side harness are connected to the same collaboration room.</span>
      </section>

      <div className="workspace">
        <aside>
          <h2>Legal review</h2>
          <p>Ask the agent to inspect or edit the shared document.</p>

          <label htmlFor="document-upload">Document</label>
          <input
            id="document-upload"
            className="document-upload"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadDocument(file);
              event.target.value = '';
            }}
          />

          <label htmlFor="prompt">Instruction</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />

          <button disabled={!canReview || !prompt.trim()} onClick={runReview}>
            {status === 'reviewing' ? 'Agent is working…' : 'Run agent'}
          </button>

          <div className="tool-output" aria-live="polite">
            <strong>Tool calls</strong>
            {tools.length === 0 ? (
              <small>Tool calls will appear here after the review.</small>
            ) : (
              <ol>{tools.map((tool, index) => (
                <li className={`tool-${toolSource(tool)}`} key={`${tool}-${index}`}>{toolLabel(tool)}</li>
              ))}</ol>
            )}
          </div>
          {answer && <p className="agent-answer"><strong>Agent response</strong>{answer}</p>}
        </aside>

        <section className="document" aria-label="Collaborative document editor">
          <div className="document-title">
            <div><b>W</b><span><strong>{activeDocument?.filename ?? 'Loading document…'}</strong><small>Room: {activeDocument?.roomId ?? 'connecting'}</small></span></div>
            <em>Live</em>
          </div>
          <div className="editor"><div ref={editorRef} /></div>
        </section>
      </div>
    </main>
  );
}
