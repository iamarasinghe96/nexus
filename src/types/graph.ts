export type NodeType =
  | 'FEDERAL_LEG'
  | 'STATE_LEG'
  | 'STATE_STRATEGY'
  | 'COUNCIL_STRATEGY'
  | 'COUNCIL_ACTION'
  | 'FORM'
  | 'CONTACT'
  | 'CONTRADICTION'

export type Pillar = 'WASTE' | 'CLIMATE' | 'BOTH'

export type Relationship =
  | 'GOVERNED_BY'
  | 'IMPLEMENTS'
  | 'CONTRADICTS'
  | 'REQUIRES'
  | 'DELIVERS'
  | 'CONTACTS'

export type UserType = 'CITIZEN' | 'CONTRACTOR' | 'COUNCIL_STAFF'
export type PillarFilter = 'ALL' | 'WASTE' | 'CLIMATE'

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  pillar: Pillar
  description: string
  metadata: Record<string, unknown>
  contradictions: string[]
}

export interface GraphEdge {
  source: string
  target: string
  relationship: Relationship
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─── Editor diff types ────────────────────────────────────────────────────────

export type GraphDiff =
  | { action: 'ADD_NODE'; payload: GraphNode }
  | { action: 'ADD_EDGE'; payload: GraphEdge }
  | { action: 'REMOVE_EDGE'; payload: { source: string; target: string } }
  | { action: 'UPDATE_NODE'; payload: { id: string; updates: Partial<Omit<GraphNode, 'id'>> } }
  | { action: 'ADD_CONTRADICTION'; payload: { nodeId: string; contradictionId: string } }

export function applyDiff(graph: GraphData, diff: GraphDiff): GraphData {
  switch (diff.action) {
    case 'ADD_NODE': {
      if (graph.nodes.some(n => n.id === diff.payload.id)) return graph
      return { ...graph, nodes: [...graph.nodes, diff.payload] }
    }
    case 'ADD_EDGE': {
      const exists = graph.edges.some(
        e => e.source === diff.payload.source && e.target === diff.payload.target && e.relationship === diff.payload.relationship,
      )
      if (exists) return graph
      return { ...graph, edges: [...graph.edges, diff.payload] }
    }
    case 'REMOVE_EDGE': {
      return {
        ...graph,
        edges: graph.edges.filter(
          e => !(e.source === diff.payload.source && e.target === diff.payload.target),
        ),
      }
    }
    case 'UPDATE_NODE': {
      return {
        ...graph,
        nodes: graph.nodes.map(n =>
          n.id === diff.payload.id ? { ...n, ...diff.payload.updates } : n,
        ),
      }
    }
    case 'ADD_CONTRADICTION': {
      return {
        ...graph,
        nodes: graph.nodes.map(n =>
          n.id === diff.payload.nodeId && !n.contradictions.includes(diff.payload.contradictionId)
            ? { ...n, contradictions: [...n.contradictions, diff.payload.contradictionId] }
            : n,
        ),
      }
    }
  }
}
