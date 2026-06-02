import { useState } from 'react'
import NexusGraph from './components/NexusGraph'
import NexusQuery from './components/NexusQuery'

type UserType = 'CITIZEN' | 'CONTRACTOR' | 'COUNCIL_STAFF'
type PillarFilter = 'ALL' | 'WASTE' | 'CLIMATE'

export default function App() {
  const [queryHighlightIds, setQueryHighlightIds] = useState<string[]>([])
  const [userType, setUserType] = useState<UserType>('COUNCIL_STAFF')
  const [pillarFilter, setPillarFilter] = useState<PillarFilter>('ALL')

  const handleHighlight = (ids: string[]) => setQueryHighlightIds(ids)
  const handleUserTypeChange = (u: UserType) => { setUserType(u); setQueryHighlightIds([]) }
  const handlePillarFilterChange = (p: PillarFilter) => { setPillarFilter(p); setQueryHighlightIds([]) }

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: '#0d2240' }}>
      {/* Graph fills full screen */}
      <div className="w-full h-full">
        <NexusGraph
          queryHighlightIds={queryHighlightIds}
          userType={userType}
          onUserTypeChange={handleUserTypeChange}
          pillarFilter={pillarFilter}
          onPillarFilterChange={handlePillarFilterChange}
        />
      </div>

      {/* Title — centred, behind query bar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none">
        <span className="text-xs font-mono tracking-widest" style={{ color: 'rgba(255,255,255,0.15)' }}>
          ALBURYCITY LEGISLATIVE INTELLIGENCE
        </span>
      </div>

      {/* Query overlay — sits above graph, centred */}
      <NexusQuery
        userType={userType}
        onHighlight={handleHighlight}
      />
    </div>
  )
}
