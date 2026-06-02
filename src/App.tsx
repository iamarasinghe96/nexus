import { useState, useEffect, useRef, useCallback } from 'react'
import NexusGraph from './components/NexusGraph'
import NexusQuery from './components/NexusQuery'
import NexusEditor from './components/NexusEditor'
import { useAuth } from './hooks/useAuth'
import { loadGraph, saveGraph, logSession } from './hooks/useFirestore'
import rawGraph from './data/nexus-graph.json'
import type { GraphData, UserType, PillarFilter } from './types/graph'

const fallbackGraph: GraphData = {
  nodes: rawGraph.nodes as GraphData['nodes'],
  edges: rawGraph.edges as GraphData['edges'],
}

type DataSource = 'firestore' | 'local' | 'loading'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type Toast = { id: string; message: string; type: 'success' | 'error' }

// ─── Toast helper ─────────────────────────────────────────────────────────────

let _toastId = 0
function makeToastId() { return String(++_toastId) }

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { user, loading: authLoading, configured: firebaseConfigured, signIn, signOut } = useAuth()

  const [graphData, setGraphData] = useState<GraphData>(fallbackGraph)
  const [graphVersion, setGraphVersion] = useState(0)
  const [dataSource, setDataSource] = useState<DataSource>('loading')
  const [queryHighlightIds, setQueryHighlightIds] = useState<string[]>([])
  const [userType, setUserType] = useState<UserType>('COUNCIL_STAFF')
  const [pillarFilter, setPillarFilter] = useState<PillarFilter>('ALL')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [unsaved, setUnsaved] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  // Session tracking refs — written on beforeunload
  const sessionStartRef = useRef(Date.now())
  const queriesRef = useRef<string[]>([])
  const nodesClickedRef = useRef<string[]>([])

  // ─── Load graph from Firestore on mount ──────────────────────────────────────

  useEffect(() => {
    loadGraph(fallbackGraph).then(({ graph, version, source }) => {
      setGraphData(graph)
      setGraphVersion(version)
      setDataSource(source)
    })
  }, [])

  // ─── Auto-switch to CITIZEN if user signs out ─────────────────────────────

  useEffect(() => {
    if (!authLoading && !user && userType === 'COUNCIL_STAFF') {
      setUserType('CITIZEN')
      setQueryHighlightIds([])
    }
  }, [user, authLoading, userType])

  // ─── Session logging on tab close ────────────────────────────────────────────

  useEffect(() => {
    const handler = () => {
      logSession({
        userType,
        userEmail: user?.email ?? null,
        queries: queriesRef.current,
        nodesClicked: nodesClickedRef.current,
        sessionDurationSeconds: Math.round((Date.now() - sessionStartRef.current) / 1000),
      })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [userType, user])

  // ─── Toast helpers ────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, type: Toast['type']) => {
    const id = makeToastId()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2500)
  }, [])

  // ─── Save graph to Firestore ──────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaveState('saving')
    const email = user?.email ?? 'council-staff@alburycity.nsw.gov.au'
    const result = await saveGraph(graphData, graphVersion, email)
    if (result.ok) {
      setGraphVersion(result.newVersion)
      setUnsaved(false)
      setSaveState('saved')
      addToast('Graph saved to Firestore', 'success')
      setTimeout(() => setSaveState('idle'), 2000)
    } else {
      setSaveState('error')
      addToast('Save failed — changes held in memory', 'error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
    return { ok: result.ok }
  }, [graphData, graphVersion, user, addToast])

  // ─── Graph change from editor ─────────────────────────────────────────────────

  const handleGraphChange = useCallback((next: GraphData) => {
    setGraphData(next)
    setUnsaved(true)
  }, [])

  // ─── Query highlight + session tracking ──────────────────────────────────────

  const handleHighlight = useCallback((ids: string[]) => setQueryHighlightIds(ids), [])

  const handleQuery = useCallback((q: string) => {
    queriesRef.current = [...queriesRef.current, q]
    handleHighlight([])
  }, [handleHighlight])

  const handleUserTypeChange = useCallback((u: UserType) => {
    setUserType(u)
    setQueryHighlightIds([])
  }, [])

  const handlePillarFilterChange = useCallback((p: PillarFilter) => {
    setPillarFilter(p)
    setQueryHighlightIds([])
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────────

  const isStaff = userType === 'COUNCIL_STAFF'
  const staffAuthenticated = isStaff && (user !== null || !firebaseConfigured)

  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ background: '#0d2240' }}>

      {/* Graph */}
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

      {/* Title */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none">
        <span className="text-xs font-mono tracking-widest" style={{ color: 'rgba(255,255,255,0.15)' }}>
          ALBURYCITY LEGISLATIVE INTELLIGENCE
        </span>
      </div>

      {/* Firestore status indicator — top centre-right */}
      <div
        className="absolute z-20 flex items-center gap-1.5 text-xs font-mono"
        style={{ top: 20, right: isStaff ? 260 : 220 }}
      >
        {dataSource === 'loading' ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>connecting…</span>
          </>
        ) : dataSource === 'firestore' ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#1D9E75' }} />
            <span style={{ color: 'rgba(29,158,117,0.7)' }}>Live · Firestore</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#fac775' }} />
            <span style={{ color: 'rgba(250,199,117,0.6)' }}>Offline · local data</span>
          </>
        )}
      </div>

      {/* Google Auth — shown when COUNCIL_STAFF and Firebase is configured */}
      {isStaff && firebaseConfigured && !authLoading && (
        <div className="absolute z-20 flex items-center gap-2" style={{ top: 44, right: 8 }}>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {user.email}
              </span>
              <button
                onClick={signOut}
                className="text-xs font-mono px-2 py-0.5 border"
                style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.3)', borderRadius: 2 }}
              >
                sign out
              </button>
            </div>
          ) : (
            <button
              onClick={signIn}
              className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 border transition-colors"
              style={{
                background: 'rgba(55,138,221,0.12)',
                borderColor: 'rgba(55,138,221,0.4)',
                color: '#378ADD',
                borderRadius: 2,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#378ADD" />
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#5dcaa5" />
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#fac775" />
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#E24B4A" />
              </svg>
              Sign in with Google
            </button>
          )}
        </div>
      )}

      {/* Query overlay */}
      <NexusQuery
        graphData={graphData}
        userType={userType}
        onHighlight={handleHighlight}
        onQuery={handleQuery}
      />

      {/* Editor — COUNCIL_STAFF only; auth required if Firebase configured */}
      {staffAuthenticated && (
        <NexusEditor
          graphData={graphData}
          graphVersion={graphVersion}
          userEmail={user?.email ?? 'staff@alburycity.nsw.gov.au'}
          userDisplayName={user?.displayName ?? 'Council Staff'}
          onGraphChange={handleGraphChange}
          onSave={handleSave}
          saveState={saveState}
          unsaved={unsaved}
        />
      )}

      {/* Toast notifications */}
      <div className="absolute bottom-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className="px-3 py-2 text-xs font-mono"
            style={{
              background: t.type === 'success' ? 'rgba(29,158,117,0.9)' : 'rgba(226,75,74,0.9)',
              color: '#fff',
              borderRadius: 2,
              minWidth: 220,
            }}
          >
            {t.type === 'success' ? '✓ ' : '✕ '}{t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
