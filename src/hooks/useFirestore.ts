import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
  query,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore'
import { getDb } from '../lib/firebase'
import type { GraphData, GraphDiff, Pillar } from '../types/graph'

// ─── Graph persistence ────────────────────────────────────────────────────────

export interface LoadedGraph {
  graph: GraphData
  version: number
  source: 'firestore' | 'local'
}

export async function loadGraph(fallback: GraphData): Promise<LoadedGraph> {
  const db = getDb()
  if (!db) return { graph: fallback, version: 0, source: 'local' }

  try {
    const snap = await getDoc(doc(db, 'nexus_graph', 'current'))
    if (!snap.exists()) return { graph: fallback, version: 0, source: 'local' }

    const data = snap.data() as {
      nodes: GraphData['nodes']
      edges: GraphData['edges']
      version?: number
    }

    return {
      graph: { nodes: data.nodes, edges: data.edges },
      version: data.version ?? 0,
      source: 'firestore',
    }
  } catch {
    return { graph: fallback, version: 0, source: 'local' }
  }
}

export async function saveGraph(
  graph: GraphData,
  version: number,
  userEmail: string,
): Promise<{ ok: boolean; newVersion: number }> {
  const db = getDb()
  if (!db) return { ok: false, newVersion: version }

  const newVersion = version + 1
  try {
    await setDoc(doc(db, 'nexus_graph', 'current'), {
      nodes: graph.nodes,
      edges: graph.edges,
      last_updated: serverTimestamp(),
      updated_by: userEmail,
      version: newVersion,
    })
    return { ok: true, newVersion }
  } catch {
    return { ok: false, newVersion: version }
  }
}

// ─── Edit audit trail ─────────────────────────────────────────────────────────

export interface EditRecord {
  userEmail: string
  userDisplayName: string
  commandText: string
  diffApplied: GraphDiff
  versionBefore: number
  versionAfter: number
  pillarAffected: Pillar | 'BOTH'
  nodeIdsAffected: string[]
}

export async function logEdit(record: EditRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await addDoc(collection(db, 'nexus_edits'), {
      timestamp: serverTimestamp(),
      user_email: record.userEmail,
      user_display_name: record.userDisplayName,
      command_text: record.commandText,
      diff_applied: record.diffApplied,
      version_before: record.versionBefore,
      version_after: record.versionAfter,
      pillar_affected: record.pillarAffected,
      node_ids_affected: record.nodeIdsAffected,
    })
  } catch { /* silently skip — in-memory edit already applied */ }
}

export interface AuditEntry {
  id: string
  timestamp: Date | null
  userEmail: string
  userDisplayName: string
  commandText: string
  diffApplied: GraphDiff
  versionBefore: number
  versionAfter: number
  pillarAffected: string
  nodeIdsAffected: string[]
}

export async function loadAuditTrail(limitCount = 50): Promise<AuditEntry[]> {
  const db = getDb()
  if (!db) return []
  try {
    const q = query(
      collection(db, 'nexus_edits'),
      orderBy('timestamp', 'desc'),
      limit(limitCount),
    )
    const snap = await getDocs(q)
    return snap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        timestamp: data['timestamp']?.toDate?.() ?? null,
        userEmail: data['user_email'] ?? '',
        userDisplayName: data['user_display_name'] ?? '',
        commandText: data['command_text'] ?? '',
        diffApplied: data['diff_applied'] as GraphDiff,
        versionBefore: data['version_before'] ?? 0,
        versionAfter: data['version_after'] ?? 0,
        pillarAffected: data['pillar_affected'] ?? '',
        nodeIdsAffected: data['node_ids_affected'] ?? [],
      }
    })
  } catch {
    return []
  }
}

// ─── Session logging ──────────────────────────────────────────────────────────

export interface SessionRecord {
  userType: 'CITIZEN' | 'CONTRACTOR' | 'COUNCIL_STAFF'
  userEmail: string | null
  queries: string[]
  nodesClicked: string[]
  sessionDurationSeconds: number
}

export async function logSession(record: SessionRecord): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await addDoc(collection(db, 'nexus_sessions'), {
      timestamp: serverTimestamp(),
      user_type: record.userType,
      user_email: record.userEmail,
      queries: record.queries,
      nodes_clicked: record.nodesClicked,
      session_duration_seconds: record.sessionDurationSeconds,
    })
  } catch { /* silently skip */ }
}
