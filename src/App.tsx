import { useState } from 'react'
import NexusGraph from './components/NexusGraph'
import NexusQuery from './components/NexusQuery'
import NexusEditor from './components/NexusEditor'
import rawGraph from './data/nexus-graph.json'
import type { GraphData, UserType, PillarFilter } from './types/graph'

const initialGraph: GraphData = {
  nodes: rawGraph.nodes as GraphData['nodes'],
  edges: rawGraph.edges as GraphData['edges'],
}

export default function App() {
  const [graphData, setGraphData] = useState<GraphData>(initialGraph)
  const [queryHighlightIds, setQueryHighlightIds] = useState<string[]>([])
  const [userType, setUserType] = useState<UserType>('COUNCIL_STAFF')
  const [pillarFilter, setPillarFilter] = useState<PillarFilter>('ALL')

  const handleHighlight = (ids: string[]) => setQueryHighlightIds(ids)
  const handleUserTypeChange = (u: UserType) => { setUserType(u); setQueryHighlightIds([]) }
  const handlePillarFilterChange = (p: PillarFilter) => { setPillarFilter(p); setQueryHighlightIds([]) }

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: '#0d2240' }}>
      <div className="w-full h-full">
        <NexusGraph
          graphData={graphData}
          queryHighlightIds={queryHighlightIds}
          userType={userType}
          onUserTypeChange={handleUserTypeChange}
          pillarFilter={pillarFilter}
          onPillarFilterChange={handlePillarFilterChange}
        />
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none">
        <span className="text-xs font-mono tracking-widest" style={{ color: 'rgba(255,255,255,0.15)' }}>
          ALBURYCITY LEGISLATIVE INTELLIGENCE
        </span>
      </div>

      <NexusQuery
        graphData={graphData}
        userType={userType}
        onHighlight={handleHighlight}
      />

      {/* Edit mode only accessible to COUNCIL_STAFF */}
      {userType === 'COUNCIL_STAFF' && (
        <NexusEditor
          graphData={graphData}
          onGraphChange={setGraphData}
        />
      )}
    </div>
  )
}
