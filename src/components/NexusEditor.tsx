import { useState, useRef, KeyboardEvent, useCallback } from 'react'
import { saveGraph, logEdit } from '../hooks/useFirestore'
import { applyDiff } from '../types/graph'
import type { GraphData, GraphDiff, GraphNode, NodeType, Pillar, Relationship } from '../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingEdit {
  command: string
  diff: GraphDiff
  preview: string
}

interface EditHistoryEntry {
  id: string
  command: string
  diff: GraphDiff
  appliedAt: string
}

interface NexusEditorProps {
  graphData: GraphData
  onGraphChange: (next: GraphData) => void
}

// ─── Groq editor system prompt ────────────────────────────────────────────────

function buildEditorSystemPrompt(graph: GraphData): string {
  const nodeList = graph.nodes.map(n => `  ${n.id} (${n.type}) — "${n.label}"`).join('\n')
  return `You are NEXUS Graph Editor, a structured diff generator for the AlburyCity NEXUS knowledge graph.

Your ONLY output is a single valid JSON object. No explanation, no markdown, no text outside the JSON.

Valid node types: FEDERAL_LEG | STATE_LEG | STATE_STRATEGY | COUNCIL_STRATEGY | COUNCIL_ACTION | FORM | CONTACT | CONTRADICTION
Valid pillars: WASTE | CLIMATE | BOTH
Valid relationships: GOVERNED_BY | IMPLEMENTS | CONTRADICTS | REQUIRES | DELIVERS | CONTACTS

Current graph nodes:
${nodeList}

Return exactly one of these structures:

ADD_NODE:
{"action":"ADD_NODE","payload":{"id":"<slug-id>","label":"<full label>","type":"<NodeType>","pillar":"<Pillar>","description":"<2 sentences>","metadata":{},"contradictions":[]}}

ADD_EDGE:
{"action":"ADD_EDGE","payload":{"source":"<existing-node-id>","target":"<existing-node-id>","relationship":"<Relationship>"}}

REMOVE_EDGE:
{"action":"REMOVE_EDGE","payload":{"source":"<existing-node-id>","target":"<existing-node-id>"}}

UPDATE_NODE:
{"action":"UPDATE_NODE","payload":{"id":"<existing-node-id>","updates":{"description":"<new description>"}}}

ADD_CONTRADICTION:
{"action":"ADD_CONTRADICTION","payload":{"nodeId":"<existing-node-id>","contradictionId":"<existing-node-id>"}}

Rules:
- For ADD_NODE the id must be a lowercase kebab-case slug derived from the label, unique from all existing ids listed above.
- For ADD_EDGE and REMOVE_EDGE, source and target MUST be existing node ids from the list above.
- For ADD_CONTRADICTION, both nodeId and contradictionId MUST be existing node ids from the list above.
- If the command is ambiguous or references nodes not in the graph, return: {"action":"ADD_NODE","payload":null,"error":"<explanation>"}`
}

// ─── Groq call ────────────────────────────────────────────────────────────────

async function parseCommandWithGroq(
  command: string,
  graph: GraphData,
): Promise<GraphDiff> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY is not set')

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0,
      max_tokens: 512,
      messages: [
        { role: 'system', content: buildEditorSystemPrompt(graph) },
        { role: 'user', content: command },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Groq API error ${response.status}: ${err}`)
  }

  const data = await response.json() as { choices: { message: { content: string } }[] }
  const raw = data.choices[0]?.message?.content ?? ''

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON returned from Groq')

  const parsed = JSON.parse(jsonMatch[0]) as { action: string; payload: unknown; error?: string }

  if (parsed.error) throw new Error(`Groq could not parse command: ${parsed.error}`)
  if (!parsed.payload) throw new Error('Groq returned null payload — check your command references valid node IDs')

  return parsed as unknown as GraphDiff
}

// ─── Diff human preview ───────────────────────────────────────────────────────

function diffToPreview(diff: GraphDiff, graph: GraphData): string {
  const findLabel = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id

  switch (diff.action) {
    case 'ADD_NODE':
      return `Add new ${diff.payload.type} node: "${diff.payload.label}" (${diff.payload.pillar})`
    case 'ADD_EDGE':
      return `Add edge: ${findLabel(diff.payload.source)} → [${diff.payload.relationship}] → ${findLabel(diff.payload.target)}`
    case 'REMOVE_EDGE':
      return `Remove edge: ${findLabel(diff.payload.source)} ↔ ${findLabel(diff.payload.target)}`
    case 'UPDATE_NODE': {
      const keys = Object.keys(diff.payload.updates).join(', ')
      return `Update "${findLabel(diff.payload.id)}" — fields: ${keys}`
    }
    case 'ADD_CONTRADICTION':
      return `Flag contradiction: "${findLabel(diff.payload.nodeId)}" ↔ "${findLabel(diff.payload.contradictionId)}"`
  }
}

// ─── Validate diff references ─────────────────────────────────────────────────

function validateDiff(diff: GraphDiff, graph: GraphData): string | null {
  const ids = new Set(graph.nodes.map(n => n.id))
  const validNodeTypes: NodeType[] = ['FEDERAL_LEG', 'STATE_LEG', 'STATE_STRATEGY', 'COUNCIL_STRATEGY', 'COUNCIL_ACTION', 'FORM', 'CONTACT', 'CONTRADICTION']
  const validPillars: Pillar[] = ['WASTE', 'CLIMATE', 'BOTH']
  const validRels: Relationship[] = ['GOVERNED_BY', 'IMPLEMENTS', 'CONTRADICTS', 'REQUIRES', 'DELIVERS', 'CONTACTS']

  switch (diff.action) {
    case 'ADD_NODE': {
      const n = diff.payload as GraphNode
      if (!n.id || !n.label) return 'ADD_NODE requires id and label'
      if (!validNodeTypes.includes(n.type)) return `Invalid node type: ${n.type}`
      if (!validPillars.includes(n.pillar)) return `Invalid pillar: ${n.pillar}`
      if (ids.has(n.id)) return `Node id "${n.id}" already exists`
      return null
    }
    case 'ADD_EDGE': {
      if (!ids.has(diff.payload.source)) return `Source node not found: ${diff.payload.source}`
      if (!ids.has(diff.payload.target)) return `Target node not found: ${diff.payload.target}`
      if (!validRels.includes(diff.payload.relationship)) return `Invalid relationship: ${diff.payload.relationship}`
      return null
    }
    case 'REMOVE_EDGE': {
      if (!ids.has(diff.payload.source)) return `Source node not found: ${diff.payload.source}`
      if (!ids.has(diff.payload.target)) return `Target node not found: ${diff.payload.target}`
      return null
    }
    case 'UPDATE_NODE': {
      if (!ids.has(diff.payload.id)) return `Node not found: ${diff.payload.id}`
      return null
    }
    case 'ADD_CONTRADICTION': {
      if (!ids.has(diff.payload.nodeId)) return `Node not found: ${diff.payload.nodeId}`
      if (!ids.has(diff.payload.contradictionId)) return `Contradiction target not found: ${diff.payload.contradictionId}`
      return null
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NexusEditor({ graphData, onGraphChange }: NexusEditorProps) {
  const [editMode, setEditMode] = useState(false)
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [history, setHistory] = useState<EditHistoryEntry[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [unsaved, setUnsaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const parseCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setPending(null)
    try {
      const diff = await parseCommandWithGroq(trimmed, graphData)
      const validationError = validateDiff(diff, graphData)
      if (validationError) throw new Error(`Validation: ${validationError}`)
      const preview = diffToPreview(diff, graphData)
      setPending({ command: trimmed, diff, preview })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [graphData])

  const applyPending = useCallback(async () => {
    if (!pending) return
    const next = applyDiff(graphData, pending.diff)
    onGraphChange(next)

    const entry: EditHistoryEntry = {
      id: crypto.randomUUID(),
      command: pending.command,
      diff: pending.diff,
      appliedAt: new Date().toISOString(),
    }
    setHistory(h => [entry, ...h])
    setUnsaved(true)
    setPending(null)
    setCommand('')

    // Async audit log — fire and forget
    logEdit({ user: 'COUNCIL_STAFF', command: pending.command, diff: pending.diff })
      .catch(() => { /* Firestore may not be configured — silently skip */ })
  }, [pending, graphData, onGraphChange])

  const discardPending = () => { setPending(null); setError(null) }

  const saveToFirestore = useCallback(async () => {
    setSaveState('saving')
    try {
      await saveGraph(graphData)
      setSaveState('saved')
      setUnsaved(false)
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (e) {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }, [graphData])

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') parseCommand(command)
    if (e.key === 'Escape') { setPending(null); setError(null) }
  }

  if (!editMode) {
    return (
      <button
        onClick={() => setEditMode(true)}
        className="absolute bottom-4 right-4 z-30 px-3 py-1.5 text-xs font-mono tracking-widest border transition-colors"
        style={{
          background: 'rgba(13,34,64,0.9)',
          borderColor: 'rgba(250,199,117,0.35)',
          color: 'rgba(250,199,117,0.55)',
          borderRadius: 2,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = '#fac775'
          e.currentTarget.style.color = '#fac775'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(250,199,117,0.35)'
          e.currentTarget.style.color = 'rgba(250,199,117,0.55)'
        }}
      >
        ✎ EDIT MODE
      </button>
    )
  }

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-30"
      style={{ background: 'rgba(6,16,34,0.97)', borderTop: '1px solid rgba(250,199,117,0.3)' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tracking-widest" style={{ color: '#fac775' }}>
            ✎ EDIT MODE
          </span>
          <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>
            COUNCIL STAFF — {graphData.nodes.length} nodes · {graphData.edges.length} edges
          </span>
          {unsaved && (
            <span className="text-xs font-mono" style={{ color: 'rgba(250,199,117,0.6)' }}>
              ● unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Save button */}
          <button
            onClick={saveToFirestore}
            disabled={saveState === 'saving' || !unsaved}
            className="px-3 py-1 text-xs font-mono tracking-widest border transition-colors"
            style={{
              background: saveState === 'saved' ? 'rgba(29,158,117,0.2)' : 'rgba(250,199,117,0.1)',
              borderColor: saveState === 'saved' ? '#1D9E75' : saveState === 'error' ? '#E24B4A' : unsaved ? '#fac775' : 'rgba(250,199,117,0.2)',
              color: saveState === 'saved' ? '#5dcaa5' : saveState === 'error' ? '#E24B4A' : unsaved ? '#fac775' : 'rgba(250,199,117,0.3)',
              borderRadius: 2,
              opacity: !unsaved && saveState === 'idle' ? 0.4 : 1,
            }}
          >
            {saveState === 'saving' ? 'SAVING…' : saveState === 'saved' ? '✓ SAVED' : saveState === 'error' ? 'SAVE FAILED' : 'SAVE CHANGES'}
          </button>
          <button
            onClick={() => { setEditMode(false); setPending(null); setError(null) }}
            className="px-3 py-1 text-xs font-mono border transition-colors"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.4)', borderRadius: 2 }}
          >
            EXIT
          </button>
        </div>
      </div>

      {/* Command input */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <span className="text-xs font-mono shrink-0" style={{ color: 'rgba(250,199,117,0.5)' }}>›</span>
        <input
          ref={inputRef}
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Edit the graph — type a command… (e.g. Add a connection between MBT and the POEO Act — GOVERNED_BY)"
          className="flex-1 text-xs font-mono px-3 py-2 outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(250,199,117,0.25)',
            color: '#fff',
            borderRadius: 2,
          }}
        />
        <button
          onClick={() => parseCommand(command)}
          disabled={loading || !command.trim()}
          className="px-3 py-2 text-xs font-mono tracking-widest border transition-colors shrink-0"
          style={{
            background: loading ? 'rgba(250,199,117,0.07)' : 'rgba(250,199,117,0.12)',
            borderColor: 'rgba(250,199,117,0.4)',
            color: loading ? 'rgba(250,199,117,0.4)' : '#fac775',
            borderRadius: 2,
          }}
        >
          {loading ? '…' : 'PARSE →'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 text-xs font-mono" style={{ background: 'rgba(226,75,74,0.1)', border: '1px solid rgba(226,75,74,0.4)', color: '#E24B4A', borderRadius: 2 }}>
          {error}
        </div>
      )}

      {/* Pending diff — confirm/discard */}
      {pending && (
        <div className="mx-4 mb-3 px-3 py-2" style={{ background: 'rgba(250,199,117,0.07)', border: '1px solid rgba(250,199,117,0.4)', borderRadius: 2 }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-mono mb-1" style={{ color: 'rgba(250,199,117,0.6)' }}>PROPOSED CHANGE</div>
              <div className="text-sm font-mono font-bold mb-1" style={{ color: '#fac775' }}>{pending.preview}</div>
              <div className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
                action: {pending.diff.action}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={applyPending}
                className="px-3 py-1.5 text-xs font-mono tracking-widest border"
                style={{ background: 'rgba(29,158,117,0.2)', borderColor: '#1D9E75', color: '#5dcaa5', borderRadius: 2 }}
              >
                APPLY ✓
              </button>
              <button
                onClick={discardPending}
                className="px-3 py-1.5 text-xs font-mono border"
                style={{ borderColor: 'rgba(226,75,74,0.4)', color: 'rgba(226,75,74,0.7)', borderRadius: 2 }}
              >
                DISCARD ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change log */}
      {history.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-xs font-mono tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
            CHANGE LOG — {history.length} edit{history.length !== 1 ? 's' : ''} this session
          </div>
          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
            {history.map(entry => (
              <div key={entry.id} className="flex items-center gap-3">
                <span className="text-xs font-mono shrink-0" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>
                  {new Date(entry.appliedAt).toLocaleTimeString()}
                </span>
                <span
                  className="text-xs font-mono px-1.5 py-0.5 shrink-0"
                  style={{ background: 'rgba(250,199,117,0.08)', color: 'rgba(250,199,117,0.6)', fontSize: 9, borderRadius: 2 }}
                >
                  {entry.diff.action}
                </span>
                <span className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {entry.command}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
