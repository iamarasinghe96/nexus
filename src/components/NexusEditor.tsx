import { useState, useRef, KeyboardEvent, useCallback, useEffect } from 'react'
import { logEdit, loadAuditTrail, type AuditEntry, type EditRecord } from '../hooks/useFirestore'
import { applyDiff } from '../types/graph'
import type { GraphData, GraphDiff, GraphNode, NodeType, Pillar, Relationship } from '../types/graph'

// ─── Types ────────────────────────────────────────────────────────────────────

type EditorTab = 'EDIT' | 'AUDIT'

interface PendingEdit {
  command: string
  diff: GraphDiff
  preview: string
}

interface SessionEdit {
  id: string
  command: string
  diff: GraphDiff
  appliedAt: string
}

export interface NexusEditorProps {
  graphData: GraphData
  graphVersion: number
  userEmail: string
  userDisplayName: string
  onGraphChange: (next: GraphData) => void
  onSave: () => Promise<{ ok: boolean }>
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  unsaved: boolean
}

// ─── Groq system prompt ───────────────────────────────────────────────────────

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

ADD_NODE: {"action":"ADD_NODE","payload":{"id":"<slug-id>","label":"<full label>","type":"<NodeType>","pillar":"<Pillar>","description":"<2 sentences>","metadata":{},"contradictions":[]}}
ADD_EDGE: {"action":"ADD_EDGE","payload":{"source":"<existing-node-id>","target":"<existing-node-id>","relationship":"<Relationship>"}}
REMOVE_EDGE: {"action":"REMOVE_EDGE","payload":{"source":"<existing-node-id>","target":"<existing-node-id>"}}
UPDATE_NODE: {"action":"UPDATE_NODE","payload":{"id":"<existing-node-id>","updates":{"description":"<new value>"}}}
ADD_CONTRADICTION: {"action":"ADD_CONTRADICTION","payload":{"nodeId":"<existing-node-id>","contradictionId":"<existing-node-id>"}}

Rules:
- ADD_NODE id must be a unique lowercase kebab-case slug not in the existing list above.
- ADD_EDGE / REMOVE_EDGE source and target MUST be existing node ids from the list above.
- ADD_CONTRADICTION nodeId and contradictionId MUST be existing node ids from the list above.
- If the command is ambiguous, return: {"action":"ADD_NODE","payload":null,"error":"<reason>"}`
}

// ─── Groq call ────────────────────────────────────────────────────────────────

async function parseCommandWithGroq(command: string, graph: GraphData): Promise<GraphDiff> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GROQ_API_KEY is not set')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`)

  const data = await res.json() as { choices: { message: { content: string } }[] }
  const raw = data.choices[0]?.message?.content ?? ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON returned from Groq')

  const parsed = JSON.parse(match[0]) as { action: string; payload: unknown; error?: string }
  if (parsed.error) throw new Error(`Groq: ${parsed.error}`)
  if (!parsed.payload) throw new Error('Groq returned null payload — check your command references valid node IDs')
  return parsed as unknown as GraphDiff
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

function diffToPreview(diff: GraphDiff, graph: GraphData): string {
  const label = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id
  switch (diff.action) {
    case 'ADD_NODE': return `Add ${diff.payload.type}: "${diff.payload.label}" (${diff.payload.pillar})`
    case 'ADD_EDGE': return `Add edge: ${label(diff.payload.source)} → [${diff.payload.relationship}] → ${label(diff.payload.target)}`
    case 'REMOVE_EDGE': return `Remove edge: ${label(diff.payload.source)} ↔ ${label(diff.payload.target)}`
    case 'UPDATE_NODE': return `Update "${label(diff.payload.id)}" — fields: ${Object.keys(diff.payload.updates).join(', ')}`
    case 'ADD_CONTRADICTION': return `Flag contradiction: "${label(diff.payload.nodeId)}" ↔ "${label(diff.payload.contradictionId)}"`
  }
}

function diffAffectedIds(diff: GraphDiff): string[] {
  switch (diff.action) {
    case 'ADD_NODE': return [diff.payload.id]
    case 'ADD_EDGE': return [diff.payload.source, diff.payload.target]
    case 'REMOVE_EDGE': return [diff.payload.source, diff.payload.target]
    case 'UPDATE_NODE': return [diff.payload.id]
    case 'ADD_CONTRADICTION': return [diff.payload.nodeId, diff.payload.contradictionId]
  }
}

function diffPillar(diff: GraphDiff, graph: GraphData): Pillar {
  const ids = diffAffectedIds(diff)
  const pillars = ids
    .map(id => graph.nodes.find(n => n.id === id)?.pillar)
    .filter(Boolean) as Pillar[]
  if (pillars.every(p => p === 'WASTE')) return 'WASTE'
  if (pillars.every(p => p === 'CLIMATE')) return 'CLIMATE'
  return 'BOTH'
}

function validateDiff(diff: GraphDiff, graph: GraphData): string | null {
  const ids = new Set(graph.nodes.map(n => n.id))
  const validTypes: NodeType[] = ['FEDERAL_LEG', 'STATE_LEG', 'STATE_STRATEGY', 'COUNCIL_STRATEGY', 'COUNCIL_ACTION', 'FORM', 'CONTACT', 'CONTRADICTION']
  const validPillars: Pillar[] = ['WASTE', 'CLIMATE', 'BOTH']
  const validRels: Relationship[] = ['GOVERNED_BY', 'IMPLEMENTS', 'CONTRADICTS', 'REQUIRES', 'DELIVERS', 'CONTACTS']

  switch (diff.action) {
    case 'ADD_NODE': {
      const n = diff.payload as GraphNode
      if (!n.id || !n.label) return 'id and label are required'
      if (!validTypes.includes(n.type)) return `Invalid type: ${n.type}`
      if (!validPillars.includes(n.pillar)) return `Invalid pillar: ${n.pillar}`
      if (ids.has(n.id)) return `Node id "${n.id}" already exists`
      return null
    }
    case 'ADD_EDGE':
      if (!ids.has(diff.payload.source)) return `Source not found: ${diff.payload.source}`
      if (!ids.has(diff.payload.target)) return `Target not found: ${diff.payload.target}`
      if (!validRels.includes(diff.payload.relationship)) return `Invalid relationship: ${diff.payload.relationship}`
      return null
    case 'REMOVE_EDGE':
      if (!ids.has(diff.payload.source)) return `Source not found: ${diff.payload.source}`
      if (!ids.has(diff.payload.target)) return `Target not found: ${diff.payload.target}`
      return null
    case 'UPDATE_NODE':
      if (!ids.has(diff.payload.id)) return `Node not found: ${diff.payload.id}`
      return null
    case 'ADD_CONTRADICTION':
      if (!ids.has(diff.payload.nodeId)) return `Node not found: ${diff.payload.nodeId}`
      if (!ids.has(diff.payload.contradictionId)) return `Contradiction target not found: ${diff.payload.contradictionId}`
      return null
  }
}

// ─── Audit tab ────────────────────────────────────────────────────────────────

function AuditTrail() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAuditTrail(50).then(data => { setEntries(data); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="p-4 text-xs font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
        Loading audit trail…
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="p-4 text-xs font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
        No edits recorded yet. Changes made in edit mode will appear here.
      </div>
    )
  }

  return (
    <div className="overflow-y-auto" style={{ maxHeight: '28vh' }}>
      <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['TIMESTAMP', 'USER', 'COMMAND', 'NODES AFFECTED', 'v'].map(h => (
              <th key={h} className="px-3 py-2 text-left" style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, letterSpacing: 1, fontWeight: 400 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr
              key={e.id}
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
            >
              <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>
                {e.timestamp ? e.timestamp.toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {e.userDisplayName || e.userEmail || 'unknown'}
              </td>
              <td className="px-3 py-1.5" style={{ color: 'rgba(255,255,255,0.65)', maxWidth: '24rem' }}>
                <span className="block truncate">{e.commandText}</span>
              </td>
              <td className="px-3 py-1.5" style={{ color: 'rgba(250,199,117,0.6)', fontSize: 9 }}>
                {e.nodeIdsAffected.join(', ') || '—'}
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {e.versionBefore}→{e.versionAfter}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NexusEditor({
  graphData,
  graphVersion,
  userEmail,
  userDisplayName,
  onGraphChange,
  onSave,
  saveState,
  unsaved,
}: NexusEditorProps) {
  const [editMode, setEditMode] = useState(false)
  const [tab, setTab] = useState<EditorTab>('EDIT')
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [history, setHistory] = useState<SessionEdit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const parseCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setPending(null)
    try {
      const diff = await parseCommandWithGroq(trimmed, graphData)
      const err = validateDiff(diff, graphData)
      if (err) throw new Error(`Validation: ${err}`)
      setPending({ command: trimmed, diff, preview: diffToPreview(diff, graphData) })
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

    setHistory(h => [{
      id: crypto.randomUUID(),
      command: pending.command,
      diff: pending.diff,
      appliedAt: new Date().toISOString(),
    }, ...h])

    setPending(null)
    setCommand('')

    // Async Firestore audit log — fire and forget
    const record: EditRecord = {
      userEmail,
      userDisplayName,
      commandText: pending.command,
      diffApplied: pending.diff,
      versionBefore: graphVersion,
      versionAfter: graphVersion + 1,
      pillarAffected: diffPillar(pending.diff, graphData),
      nodeIdsAffected: diffAffectedIds(pending.diff),
    }
    logEdit(record).catch(() => {})
  }, [pending, graphData, onGraphChange, userEmail, userDisplayName, graphVersion])

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
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#fac775'; e.currentTarget.style.color = '#fac775' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(250,199,117,0.35)'; e.currentTarget.style.color = 'rgba(250,199,117,0.55)' }}
      >
        ✎ EDIT MODE
      </button>
    )
  }

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-30"
      style={{ background: 'rgba(6,16,34,0.98)', borderTop: '1px solid rgba(250,199,117,0.3)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-2.5 pb-0">
        <div className="flex items-center gap-4">
          {/* Tabs */}
          <div className="flex gap-1">
            {(['EDIT', 'AUDIT'] as EditorTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-3 py-1.5 text-xs font-mono tracking-widest border-b-2 transition-colors"
                style={{
                  borderBottomColor: tab === t ? '#fac775' : 'transparent',
                  color: tab === t ? '#fac775' : 'rgba(255,255,255,0.3)',
                  background: 'none',
                  border: 'none',
                  borderBottom: `2px solid ${tab === t ? '#fac775' : 'transparent'}`,
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.18)' }}>
            {graphData.nodes.length} nodes · {graphData.edges.length} edges · v{graphVersion}
          </span>
          {unsaved && (
            <span className="text-xs font-mono" style={{ color: 'rgba(250,199,117,0.55)' }}>
              ● unsaved
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSave}
            disabled={saveState === 'saving' || !unsaved}
            className="px-3 py-1 text-xs font-mono tracking-widest border transition-colors"
            style={{
              background: saveState === 'saved' ? 'rgba(29,158,117,0.15)' : 'rgba(250,199,117,0.08)',
              borderColor: saveState === 'saved' ? '#1D9E75' : saveState === 'error' ? '#E24B4A' : unsaved ? 'rgba(250,199,117,0.6)' : 'rgba(250,199,117,0.15)',
              color: saveState === 'saved' ? '#5dcaa5' : saveState === 'error' ? '#E24B4A' : unsaved ? '#fac775' : 'rgba(250,199,117,0.25)',
              borderRadius: 2,
              opacity: !unsaved && saveState === 'idle' ? 0.5 : 1,
            }}
          >
            {saveState === 'saving' ? 'SAVING…' : saveState === 'saved' ? '✓ SAVED TO FIRESTORE' : saveState === 'error' ? '✕ SAVE FAILED' : 'SAVE CHANGES'}
          </button>
          <button
            onClick={() => { setEditMode(false); setPending(null); setError(null) }}
            className="px-3 py-1 text-xs font-mono border"
            style={{ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.35)', borderRadius: 2 }}
          >
            EXIT
          </button>
        </div>
      </div>

      {/* Edit tab */}
      {tab === 'EDIT' && (
        <div className="px-4 pt-2 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono" style={{ color: 'rgba(250,199,117,0.45)' }}>›</span>
            <input
              ref={inputRef}
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Edit the graph — type a command… (e.g. Add a connection between MBT and the POEO Act — GOVERNED_BY)"
              className="flex-1 text-xs font-mono px-3 py-2 outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(250,199,117,0.2)',
                color: '#fff',
                borderRadius: 2,
              }}
            />
            <button
              onClick={() => parseCommand(command)}
              disabled={loading || !command.trim()}
              className="px-3 py-2 text-xs font-mono tracking-widest border shrink-0"
              style={{
                background: 'rgba(250,199,117,0.1)',
                borderColor: loading ? 'rgba(250,199,117,0.2)' : 'rgba(250,199,117,0.5)',
                color: loading ? 'rgba(250,199,117,0.35)' : '#fac775',
                borderRadius: 2,
              }}
            >
              {loading ? '…' : 'PARSE →'}
            </button>
          </div>

          {error && (
            <div className="mb-2 px-3 py-2 text-xs font-mono" style={{ background: 'rgba(226,75,74,0.08)', border: '1px solid rgba(226,75,74,0.35)', color: '#E24B4A', borderRadius: 2 }}>
              {error}
            </div>
          )}

          {pending && (
            <div className="mb-2 px-3 py-2" style={{ background: 'rgba(250,199,117,0.06)', border: '1px solid rgba(250,199,117,0.35)', borderRadius: 2 }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono mb-0.5" style={{ color: 'rgba(250,199,117,0.5)', fontSize: 9 }}>PROPOSED CHANGE</div>
                  <div className="text-sm font-mono font-bold truncate" style={{ color: '#fac775' }}>{pending.preview}</div>
                  <div className="text-xs font-mono mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>action: {pending.diff.action}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={applyPending} className="px-3 py-1 text-xs font-mono border" style={{ background: 'rgba(29,158,117,0.15)', borderColor: '#1D9E75', color: '#5dcaa5', borderRadius: 2 }}>
                    APPLY ✓
                  </button>
                  <button onClick={() => { setPending(null); setError(null) }} className="px-3 py-1 text-xs font-mono border" style={{ borderColor: 'rgba(226,75,74,0.4)', color: 'rgba(226,75,74,0.65)', borderRadius: 2 }}>
                    DISCARD ✕
                  </button>
                </div>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div>
              <div className="text-xs font-mono mb-1.5" style={{ color: 'rgba(255,255,255,0.18)', fontSize: 9, letterSpacing: 1 }}>
                SESSION EDITS — {history.length}
              </div>
              <div className="flex flex-col gap-1 max-h-20 overflow-y-auto">
                {history.map(e => (
                  <div key={e.id} className="flex items-center gap-3">
                    <span className="text-xs font-mono shrink-0" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>
                      {new Date(e.appliedAt).toLocaleTimeString('en-AU', { timeStyle: 'short' })}
                    </span>
                    <span className="text-xs font-mono px-1.5 py-0.5 shrink-0" style={{ background: 'rgba(250,199,117,0.08)', color: 'rgba(250,199,117,0.5)', fontSize: 9, borderRadius: 2 }}>
                      {e.diff.action}
                    </span>
                    <span className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{e.command}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audit tab */}
      {tab === 'AUDIT' && <AuditTrail />}
    </div>
  )
}
