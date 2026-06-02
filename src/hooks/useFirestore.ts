import { doc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { getFirestoreDb } from '../lib/firebase'
import type { GraphData } from '../types/graph'

export async function saveGraph(graph: GraphData): Promise<void> {
  const db = getFirestoreDb()
  if (!db) return
  await setDoc(doc(db, 'nexus_graph', 'current'), {
    nodes: graph.nodes,
    edges: graph.edges,
    updatedAt: serverTimestamp(),
  })
}

export async function logEdit(params: {
  user: string
  command: string
  diff: object
}): Promise<void> {
  const db = getFirestoreDb()
  if (!db) return
  await addDoc(collection(db, 'nexus_edits'), {
    ...params,
    timestamp: serverTimestamp(),
  })
}
