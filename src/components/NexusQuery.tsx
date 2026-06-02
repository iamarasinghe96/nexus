import { useState, useRef, useCallback, KeyboardEvent } from 'react'
import rawGraph from '../data/nexus-graph.json'

// ─── Types ────────────────────────────────────────────────────────────────────

type UserType = 'CITIZEN' | 'CONTRACTOR' | 'COUNCIL_STAFF'

interface GroqResponse {
  answer: string
  highlighted_nodes: string[]
  forms: string[]
  contacts: string[]
  contradictions: string[]
}

interface GraphNode {
  id: string
  label: string
  type: string
  pillar: string
  description: string
  metadata: Record<string, unknown>
  contradictions: string[]
}

interface NexusQueryProps {
  userType: UserType
  onHighlight: (nodeIds: string[]) => void
}

// ─── Groq API ─────────────────────────────────────────────────────────────────

// Condensed node context — keeps token count reasonable while retaining all lookupable fields
function buildGraphContext(): string {
  const nodes = rawGraph.nodes as GraphNode[]
  return JSON.stringify(
    nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.type,
      pillar: n.pillar,
      description: n.description,
      contradictions: n.contradictions,
      metadata: n.metadata,
    })),
    null,
    0,
  )
}

const GRAPH_CONTEXT = buildGraphContext()

const SYSTEM_PROMPT = `You are NEXUS, a legislative navigation assistant for AlburyCity Council. You have access to a knowledge graph of federal, state and council legislation, strategies, actions, forms and contacts across two pillars: Waste Recovery and Climate Change Adaptation.

When a user asks a question, identify the most relevant nodes from the graph, return a plain language answer appropriate for the user type, and return a structured JSON response.

Always flag contradictions if they are relevant to the query. Always surface relevant forms and contacts. Be concise — answers should be 2-4 sentences maximum.

You MUST respond with ONLY valid JSON matching this exact format:
{
  "answer": "Plain language answer here",
  "highlighted_nodes": ["node-id-1", "node-id-2"],
  "forms": ["form-node-id-1"],
  "contacts": ["contact-node-id-1"],
  "contradictions": ["contradiction-node-id-1"]
}

Only include node IDs that exist in the graph context provided. Do not include node IDs that are not in the graph.`

async function queryGroq(
  question: string,
  userType: UserType,
): Promise<GroqResponse> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY is not set')

  const userLabel = userType === 'COUNCIL_STAFF' ? 'Council Staff' : userType === 'CITIZEN' ? 'Citizen' : 'Contractor'

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `User type: ${userLabel}\n\nKnowledge graph nodes:\n${GRAPH_CONTEXT}\n\nQuestion: ${question}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Groq API error ${response.status}: ${err}`)
  }

  const data = await response.json() as { choices: { message: { content: string } }[] }
  const raw = data.choices[0]?.message?.content ?? ''

  // Extract JSON from response — model may wrap in markdown fences
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON object found in Groq response')

  const parsed = JSON.parse(jsonMatch[0]) as Partial<GroqResponse>
  return {
    answer: parsed.answer ?? 'No answer returned.',
    highlighted_nodes: Array.isArray(parsed.highlighted_nodes) ? parsed.highlighted_nodes : [],
    forms: Array.isArray(parsed.forms) ? parsed.forms : [],
    contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
    contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
  }
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

function getNode(id: string): GraphNode | undefined {
  return (rawGraph.nodes as GraphNode[]).find(n => n.id === id)
}

const EXAMPLE_QUERIES = [
  'Where do I apply for commercial waste disposal at AWMC?',
  'What legislation governs landfill gas capture at AWMC?',
  'Does the proposed IVC conflict with any legislation?',
  'What are AlburyCity\'s 2030 emission targets?',
  'Who do I contact about an Environment Protection Licence?',
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function NexusQuery({ userType, onHighlight }: NexusQueryProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GroqResponse | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setResult(null)
    setOpen(true)
    try {
      const res = await queryGroq(trimmed, userType)
      setResult(res)
      // Merge all returned IDs for graph highlight
      const allIds = [
        ...res.highlighted_nodes,
        ...res.forms,
        ...res.contacts,
        ...res.contradictions,
      ]
      onHighlight([...new Set(allIds)])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      onHighlight([])
    } finally {
      setLoading(false)
    }
  }, [userType, onHighlight])

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit(query)
    if (e.key === 'Escape') { setOpen(false); onHighlight([]) }
  }

  const clear = () => {
    setQuery('')
    setResult(null)
    setError(null)
    setOpen(false)
    onHighlight([])
    inputRef.current?.focus()
  }

  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex flex-col items-center pointer-events-none">
      {/* Search bar row */}
      <div
        className="mt-4 flex items-center gap-2 pointer-events-auto"
        style={{ width: '42rem', maxWidth: 'calc(100vw - 32rem)' }}
      >
        {/* NEXUS wordmark */}
        <span
          className="text-xs font-mono tracking-widest whitespace-nowrap"
          style={{ color: '#1D9E75', letterSpacing: 4 }}
        >
          NEXUS
        </span>

        {/* Input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about legislation, actions, forms or contacts…"
            className="w-full text-xs font-mono px-3 py-2 pr-8 outline-none"
            style={{
              background: 'rgba(10,25,50,0.92)',
              border: '1px solid rgba(29,158,117,0.4)',
              color: '#fff',
              borderRadius: 2,
            }}
          />
          {query && (
            <button
              onClick={clear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={() => submit(query)}
          disabled={loading || !query.trim()}
          className="px-3 py-2 text-xs font-mono tracking-widest border transition-colors"
          style={{
            background: loading ? 'rgba(29,158,117,0.1)' : 'rgba(29,158,117,0.2)',
            borderColor: '#1D9E75',
            color: loading ? 'rgba(93,202,165,0.5)' : '#5dcaa5',
            borderRadius: 2,
            minWidth: 64,
          }}
        >
          {loading ? '…' : 'ASK →'}
        </button>
      </div>

      {/* Results panel */}
      {open && (
        <div
          className="mt-1 pointer-events-auto overflow-y-auto"
          style={{
            width: '42rem',
            maxWidth: 'calc(100vw - 32rem)',
            maxHeight: '70vh',
            background: 'rgba(8,20,42,0.98)',
            border: '1px solid rgba(29,158,117,0.3)',
            borderRadius: 2,
          }}
        >
          {/* Loading skeleton */}
          {loading && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-mono" style={{ color: '#1D9E75' }}>NEXUS</span>
                <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>processing query…</span>
              </div>
              {[80, 65, 72].map((w, i) => (
                <div
                  key={i}
                  className="mb-2 h-2 rounded"
                  style={{ width: `${w}%`, background: 'rgba(255,255,255,0.07)', animation: 'pulse 1.4s ease-in-out infinite' }}
                />
              ))}
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="p-4">
              <div className="text-xs font-mono mb-1" style={{ color: '#E24B4A' }}>QUERY ERROR</div>
              <div className="text-xs" style={{ color: 'rgba(226,75,74,0.8)' }}>{error}</div>
              {error.includes('VITE_GROQ_API_KEY') && (
                <div className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Set VITE_GROQ_API_KEY in your .env file to enable AI queries.
                </div>
              )}
            </div>
          )}

          {/* Answer */}
          {result && !loading && (
            <div className="p-4">
              {/* Answer text */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono tracking-widest" style={{ color: '#1D9E75' }}>NEXUS</span>
                  <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {result.highlighted_nodes.length} node{result.highlighted_nodes.length !== 1 ? 's' : ''} highlighted
                  </span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {result.answer}
                </p>
              </div>

              {/* Contradictions — amber cards */}
              {result.contradictions.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-mono tracking-wider mb-2" style={{ color: '#fac775' }}>
                    ⚠ CONTRADICTIONS FLAGGED
                  </div>
                  {result.contradictions.map(id => {
                    const node = getNode(id)
                    if (!node) return null
                    return (
                      <div
                        key={id}
                        className="mb-2 p-3"
                        style={{ background: 'rgba(250,199,117,0.07)', border: '1px solid rgba(250,199,117,0.3)', borderRadius: 2 }}
                      >
                        <div className="text-xs font-mono font-bold mb-1" style={{ color: '#fac775' }}>
                          {node.label}
                        </div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                          {node.description}
                        </div>
                        {node.metadata['severity'] != null && (
                          <div className="mt-1 text-xs font-mono" style={{ color: 'rgba(250,199,117,0.6)' }}>
                            SEVERITY: {String(node.metadata['severity'])}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Forms — green action buttons */}
              {result.forms.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-mono tracking-wider mb-2" style={{ color: '#97C459' }}>
                    RELEVANT FORMS
                  </div>
                  {result.forms.map(id => {
                    const node = getNode(id)
                    if (!node) return null
                    return (
                      <div
                        key={id}
                        className="mb-2 p-3 flex items-start justify-between gap-3"
                        style={{ background: 'rgba(151,196,89,0.07)', border: '1px solid rgba(151,196,89,0.3)', borderRadius: 2 }}
                      >
                        <div className="flex-1">
                          <div className="text-xs font-mono font-bold mb-1" style={{ color: '#97C459' }}>
                            {node.label}
                          </div>
                          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                            {node.description}
                          </div>
                          {node.metadata['issuingBody'] != null && (
                            <div className="mt-1 text-xs font-mono" style={{ color: 'rgba(151,196,89,0.6)' }}>
                              {String(node.metadata['issuingBody'])}
                            </div>
                          )}
                        </div>
                        <button
                          className="shrink-0 px-2 py-1 text-xs font-mono whitespace-nowrap"
                          style={{
                            background: 'rgba(151,196,89,0.15)',
                            border: '1px solid rgba(151,196,89,0.5)',
                            color: '#97C459',
                            borderRadius: 2,
                          }}
                        >
                          Apply here →
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Contacts — grey cards */}
              {result.contacts.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-mono tracking-wider mb-2" style={{ color: '#888780' }}>
                    RELEVANT CONTACTS
                  </div>
                  {result.contacts.map(id => {
                    const node = getNode(id)
                    if (!node) return null
                    return (
                      <div
                        key={id}
                        className="mb-2 p-3"
                        style={{ background: 'rgba(136,135,128,0.08)', border: '1px solid rgba(136,135,128,0.3)', borderRadius: 2 }}
                      >
                        <div className="text-xs font-mono font-bold mb-1" style={{ color: '#888780' }}>
                          {node.label}
                        </div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                          {node.description}
                        </div>
                        {node.metadata['phone'] != null && (
                          <div className="mt-1 text-xs font-mono" style={{ color: 'rgba(136,135,128,0.8)' }}>
                            ☎ {String(node.metadata['phone'])}
                          </div>
                        )}
                        {node.metadata['responsibilities'] != null && (
                          <div className="mt-1 text-xs" style={{ color: 'rgba(136,135,128,0.6)' }}>
                            {Array.isArray(node.metadata['responsibilities'])
                              ? (node.metadata['responsibilities'] as string[]).join(' · ')
                              : String(node.metadata['responsibilities'])}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Close */}
              <button
                onClick={clear}
                className="text-xs font-mono"
                style={{ color: 'rgba(255,255,255,0.2)' }}
              >
                clear ✕
              </button>
            </div>
          )}

          {/* Example queries — shown only when idle with empty input */}
          {!loading && !result && !error && (
            <div className="p-4">
              <div className="text-xs font-mono tracking-wider mb-3" style={{ color: 'rgba(255,255,255,0.25)' }}>
                EXAMPLE QUERIES
              </div>
              {EXAMPLE_QUERIES.map(q => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); submit(q) }}
                  className="block w-full text-left text-xs font-mono mb-2 px-2 py-1.5 transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.5)',
                    borderRadius: 2,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(29,158,117,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
