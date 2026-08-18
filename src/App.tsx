import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';

type Status = 'connecting' | 'ready' | 'reviewing' | 'complete' | 'error';

type ReviewResponse = {
  answer: string;
  results: Array<{ tool: string }>;
};

const statusLabels: Record<Status, string> = {
  connecting: 'Connecting',
  ready: 'Ready',
  reviewing: 'Reviewing',
  complete: 'Review complete',
  error: 'Something went wrong',
};

const API_URL = import.meta.env.VITE_API_URL ?? '';
const COLLABORATION_URL = import.meta.env.VITE_COLLABORATION_URL ?? 'ws://127.0.0.1:1234';

function toolLabel(tool: string) {
  const source = tool.startsWith('superdoc_') ? 'superdoc' : 'custom';
  return `${source}: ${tool}`;
}

export default function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [tools, setTools] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('Identify the termination clause and make it bold.');
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    let active = true;
    let superdoc: SuperDoc | undefined;

    async function openDocument() {
      const response = await fetch('/sample.docx');
      if (!response.ok) throw new Error(`The sample document returned ${response.status}.`);
      const data = await response.blob();
      if (!active) return;

      superdoc = new SuperDoc({
        selector: editor,
        documents: [
          {
            id: 'agent-harness-demo',
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data,
            v2Collaboration: {
              providerType: 'hocuspocus',
              documentId: 'agent-harness-demo',
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
  }, []);

  async function runReview() {
    setStatus('reviewing');
    setTools([]);
    setAnswer('');
    try {
      const response = await fetch(`${API_URL}/api/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
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
              <ol>{tools.map((tool, index) => <li key={`${tool}-${index}`}>{toolLabel(tool)}</li>)}</ol>
            )}
          </div>
          {answer && <p className="agent-answer"><strong>Agent response</strong>{answer}</p>}
        </aside>

        <section className="document" aria-label="Collaborative document editor">
          <div className="document-title">
            <div><b>W</b><span><strong>Mutual NDA.docx</strong><small>Room: agent-harness-demo</small></span></div>
            <em>Live</em>
          </div>
          <div className="editor"><div ref={editorRef} /></div>
        </section>
      </div>
    </main>
  );
}
