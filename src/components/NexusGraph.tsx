import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import type { GraphData, NodeType, Pillar, Relationship, UserType, PillarFilter } from '../types/graph'

// ─── Local simulation types ───────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  type: NodeType
  pillar: Pillar
  description: string
  metadata: Record<string, unknown>
  contradictions: string[]
  degree: number
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relationship: Relationship
  sourceId: string
  targetId: string
}

interface SelectedNode {
  node: SimNode
  connectedIds: Set<string>
}

export interface NexusGraphProps {
  graphData: GraphData
  queryHighlightIds?: string[]
  userType: UserType
  pillarFilter: PillarFilter
}

// ─── Design constants ─────────────────────────────────────────────────────────

const NODE_COLOUR: Record<NodeType, string> = {
  FEDERAL_LEG: '#378ADD',
  STATE_LEG: '#1D9E75',
  STATE_STRATEGY: '#5dcaa5',
  COUNCIL_STRATEGY: '#fac775',
  COUNCIL_ACTION: '#ffffff',
  FORM: '#97C459',
  CONTACT: '#888780',
  CONTRADICTION: '#E24B4A',
}

const EDGE_COLOUR: Record<Relationship, string> = {
  GOVERNED_BY: 'rgba(255,255,255,0.2)',
  IMPLEMENTS: 'rgba(29,158,117,0.4)',
  CONTRADICTS: 'rgba(226,75,74,0.8)',
  REQUIRES: 'rgba(250,199,117,0.4)',
  DELIVERS: 'rgba(151,196,89,0.4)',
  CONTACTS: 'rgba(136,135,128,0.4)',
}

const RING_RANK: Record<NodeType, number> = {
  COUNCIL_ACTION: 1,
  COUNCIL_STRATEGY: 2,
  STATE_LEG: 3,
  STATE_STRATEGY: 3,
  FEDERAL_LEG: 4,
  FORM: 1,
  CONTACT: 2,
  CONTRADICTION: 1,
}

const USER_EMPHASIS: Record<UserType, NodeType[]> = {
  CITIZEN: ['FORM', 'CONTACT'],
  CONTRACTOR: ['COUNCIL_ACTION', 'STATE_LEG'],
  COUNCIL_STAFF: [
    'FEDERAL_LEG', 'STATE_LEG', 'STATE_STRATEGY',
    'COUNCIL_STRATEGY', 'COUNCIL_ACTION', 'FORM', 'CONTACT', 'CONTRADICTION',
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ringRadius(rank: number, maxR: number): number {
  return (rank / 4.5) * maxR
}

function pillarX(pillar: Pillar, cx: number): number {
  if (pillar === 'WASTE') return cx - cx * 0.35
  if (pillar === 'CLIMATE') return cx + cx * 0.35
  return cx
}

function nodeRadius(degree: number): number {
  return Math.max(5, Math.min(16, 5 + degree * 1.2))
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ')
  }
  return String(value)
}

const SKIP_META_KEYS = new Set(['links'])

// ─── Component ────────────────────────────────────────────────────────────────

export default function NexusGraph({
  graphData,
  queryHighlightIds,
  userType,
  pillarFilter,
}: NexusGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selected, setSelected] = useState<SelectedNode | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SimNode } | null>(null)

  // Live refs to D3 selections so the highlight effect can update without re-simulation
  const nodeSelRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null)
  const linkSelRef = useRef<d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null)
  const emphasisRef = useRef<NodeType[]>(USER_EMPHASIS[userType])

  const visibleNodes = useCallback((): SimNode[] => {
    const degreeMap = new Map<string, number>()
    graphData.edges.forEach(e => {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1)
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1)
    })
    return graphData.nodes
      .filter(n => pillarFilter === 'ALL' || n.pillar === pillarFilter || n.pillar === 'BOTH')
      .map(n => ({ ...n, degree: degreeMap.get(n.id) ?? 0, x: undefined, y: undefined }))
  }, [pillarFilter, graphData])

  const visibleEdges = useCallback((nodeIds: Set<string>): SimLink[] => {
    return graphData.edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ ...e, sourceId: e.source, targetId: e.target, source: e.source, target: e.target }))
  }, [graphData])

  // ─── Query highlight effect — runs when queryHighlightIds changes ─────────────

  useEffect(() => {
    const nodeSel = nodeSelRef.current
    const linkSel = linkSelRef.current
    const emphasis = emphasisRef.current
    if (!nodeSel || !linkSel) return

    if (!queryHighlightIds || queryHighlightIds.length === 0) {
      // Reset to default emphasis state
      nodeSel.selectAll<SVGCircleElement, SimNode>('circle')
        .attr('opacity', (n: SimNode) =>
          emphasis.includes(n.type) ? 1 : (userType === 'COUNCIL_STAFF' ? 0.85 : 0.35),
        )
        .attr('stroke-width', (n: SimNode) => n.type === 'CONTRADICTION' ? 2 : 1)
        .attr('stroke', (n: SimNode) => n.type === 'CONTRADICTION' ? '#E24B4A' : 'rgba(255,255,255,0.15)')
      nodeSel.selectAll('text').attr('opacity', 1)
      linkSel.attr('opacity', 1).attr('stroke-width', (l: SimLink) => l.relationship === 'CONTRADICTS' ? 2 : 1)
      return
    }

    const hitSet = new Set(queryHighlightIds)

    nodeSel.selectAll<SVGCircleElement, SimNode>('circle')
      .attr('opacity', (n: SimNode) => hitSet.has(n.id) ? 1 : 0.1)
      .attr('stroke', (n: SimNode) => hitSet.has(n.id) ? NODE_COLOUR[n.type] : 'rgba(255,255,255,0.08)')
      .attr('stroke-width', (n: SimNode) => hitSet.has(n.id) ? 2.5 : 0.5)

    nodeSel.selectAll<SVGTextElement, SimNode>('text')
      .attr('opacity', (n: SimNode) => hitSet.has(n.id) ? 1 : 0.08)

    linkSel
      .attr('opacity', (l: SimLink) => {
        const src = typeof l.source === 'object' ? (l.source as SimNode).id : l.source as string
        const tgt = typeof l.target === 'object' ? (l.target as SimNode).id : l.target as string
        return (hitSet.has(src) && hitSet.has(tgt)) ? 1 : 0.05
      })
      .attr('stroke-width', (l: SimLink) => l.relationship === 'CONTRADICTS' ? 2 : 1)
  }, [queryHighlightIds, userType])

  // ─── Main D3 render ───────────────────────────────────────────────────────────

  useEffect(() => {
    emphasisRef.current = USER_EMPHASIS[userType]

    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    nodeSelRef.current = null
    linkSelRef.current = null

    const W = svgRef.current!.clientWidth || window.innerWidth
    const H = svgRef.current!.clientHeight || window.innerHeight
    const cx = W / 2
    const cy = H / 2
    const maxR = Math.min(cx, cy) * 0.88

    const root = svg.append('g').attr('class', 'root')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', e => root.attr('transform', e.transform))
    svg.call(zoom)

    root.append('text')
      .attr('x', cx * 0.5).attr('y', 28)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(29,158,117,0.18)')
      .attr('font-size', 13).attr('font-family', 'monospace').attr('letter-spacing', 3)
      .text('WASTE RECOVERY')

    root.append('text')
      .attr('x', cx * 1.5).attr('y', 28)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(55,138,221,0.18)')
      .attr('font-size', 13).attr('font-family', 'monospace').attr('letter-spacing', 3)
      .text('CLIMATE ADAPTATION')

    root.append('line')
      .attr('x1', cx).attr('y1', 0).attr('x2', cx).attr('y2', H)
      .attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-dasharray', '4 6')

    ;[1, 2, 3, 4].forEach(rank => {
      root.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', ringRadius(rank, maxR))
        .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', 1)
    })

    const nodes = visibleNodes()
    const nodeIds = new Set(nodes.map(n => n.id))
    const links = visibleEdges(nodeIds)
    const emphasis = USER_EMPHASIS[userType]

    const linkGroup = root.append('g').attr('class', 'links')
    const linkSel = linkGroup.selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .enter().append('line')
      .attr('stroke', d => EDGE_COLOUR[d.relationship])
      .attr('stroke-width', d => d.relationship === 'CONTRADICTS' ? 2 : 1)
    linkSelRef.current = linkSel

    const nodeGroup = root.append('g').attr('class', 'nodes')
    const nodeSel = nodeGroup.selectAll<SVGGElement, SimNode>('g')
      .data(nodes, d => d.id)
      .enter().append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
    nodeSelRef.current = nodeSel

    nodeSel.append('circle')
      .attr('r', d => nodeRadius(d.degree))
      .attr('fill', d => NODE_COLOUR[d.type])
      .attr('stroke', d => d.type === 'CONTRADICTION' ? '#E24B4A' : 'rgba(255,255,255,0.15)')
      .attr('stroke-width', d => d.type === 'CONTRADICTION' ? 2 : 1)
      .attr('opacity', d => emphasis.includes(d.type) ? 1 : (userType === 'COUNCIL_STAFF' ? 0.85 : 0.35))

    nodeSel.filter(d => d.contradictions.length > 0 || d.type === 'CONTRADICTION')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -(nodeRadius(d.degree) + 2))
      .attr('font-size', 9).attr('fill', '#fac775')
      .text('⚠')

    nodeSel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => nodeRadius(d.degree) + 11)
      .attr('font-size', 8).attr('font-family', 'monospace')
      .attr('fill', d => {
        if (!emphasis.includes(d.type) && userType !== 'COUNCIL_STAFF') return 'rgba(255,255,255,0.2)'
        return d.type === 'COUNCIL_ACTION' ? 'rgba(255,255,255,0.75)' : NODE_COLOUR[d.type]
      })
      .attr('pointer-events', 'none')
      .text(d => d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label)

    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    nodeSel.call(drag)

    nodeSel
      .on('mouseenter', (event: MouseEvent, d: SimNode) => setTooltip({ x: event.clientX, y: event.clientY, node: d }))
      .on('mousemove', (event: MouseEvent) => setTooltip(t => t ? { ...t, x: event.clientX, y: event.clientY } : null))
      .on('mouseleave', () => setTooltip(null))

    nodeSel.on('click', (event: MouseEvent, d: SimNode) => {
      event.stopPropagation()
      const connectedIds = new Set<string>([d.id])
      links.forEach(l => {
        const src = typeof l.source === 'object' ? (l.source as SimNode).id : l.source as string
        const tgt = typeof l.target === 'object' ? (l.target as SimNode).id : l.target as string
        if (src === d.id) connectedIds.add(tgt)
        if (tgt === d.id) connectedIds.add(src)
      })
      setSelected({ node: d, connectedIds })

      nodeSel.selectAll<SVGCircleElement, SimNode>('circle')
        .attr('opacity', (n: SimNode) => connectedIds.has(n.id) ? 1 : 0.12)
      nodeSel.selectAll<SVGTextElement, SimNode>('text')
        .attr('opacity', (n: SimNode) => connectedIds.has(n.id) ? 1 : 0.12)
      linkSel
        .attr('opacity', (l: SimLink) => {
          const src = typeof l.source === 'object' ? (l.source as SimNode).id : l.source as string
          const tgt = typeof l.target === 'object' ? (l.target as SimNode).id : l.target as string
          return (src === d.id || tgt === d.id) ? 1 : 0.06
        })
        .attr('stroke-width', (l: SimLink) => {
          const src = typeof l.source === 'object' ? (l.source as SimNode).id : l.source as string
          const tgt = typeof l.target === 'object' ? (l.target as SimNode).id : l.target as string
          return (src === d.id || tgt === d.id) && l.relationship === 'CONTRADICTS' ? 3 : 1
        })

      if (d.type === 'CONTRADICTION' || d.contradictions.length > 0) {
        nodeSel.filter((n: SimNode) => d.contradictions.includes(n.id) || n.contradictions.includes(d.id))
          .select('circle').attr('stroke', '#E24B4A').attr('stroke-width', 3)
      }
    })

    nodeSel.on('dblclick', (event: MouseEvent, d: SimNode) => {
      event.stopPropagation()
      if (d.x == null || d.y == null) return
      const scale = 1.8
      svg.transition().duration(600).call(
        zoom.transform,
        d3.zoomIdentity.translate(W / 2 - scale * d.x, H / 2 - scale * d.y).scale(scale),
      )
    })

    svg.on('click', () => {
      setSelected(null)
      nodeSel.selectAll<SVGCircleElement, SimNode>('circle')
        .attr('opacity', (n: SimNode) => emphasis.includes(n.type) ? 1 : (userType === 'COUNCIL_STAFF' ? 0.85 : 0.35))
        .attr('stroke', (n: SimNode) => n.type === 'CONTRADICTION' ? '#E24B4A' : 'rgba(255,255,255,0.15)')
        .attr('stroke-width', (n: SimNode) => n.type === 'CONTRADICTION' ? 2 : 1)
      nodeSel.selectAll('text').attr('opacity', 1)
      linkSel.attr('opacity', 1).attr('stroke-width', (l: SimLink) => l.relationship === 'CONTRADICTS' ? 2 : 1)
    })

    const sim = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links)
        .id(d => d.id)
        .distance(d => d.relationship === 'GOVERNED_BY' ? 80 : d.relationship === 'CONTRADICTS' ? 120 : 60)
        .strength(0.4),
      )
      .force('charge', d3.forceManyBody<SimNode>().strength(-220))
      .force('collision', d3.forceCollide<SimNode>().radius(d => nodeRadius(d.degree) + 10))
      .force('pillarX', d3.forceX<SimNode>().x(d => pillarX(d.pillar, cx)).strength(0.25))
      .force('ringR', (() => {
        const alpha = 0.18
        return function (a: number) {
          nodes.forEach(n => {
            if (n.x == null || n.y == null) return
            const dx = n.x - cx
            const dy = n.y - cy
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const targetR = ringRadius(RING_RANK[n.type], maxR)
            const diff = targetR - dist
            n.vx = (n.vx ?? 0) + (dx / dist) * diff * alpha * a
            n.vy = (n.vy ?? 0) + (dy / dist) * diff * alpha * a
          })
        }
      })())
      .force('centerY', d3.forceY<SimNode>().y(cy).strength(0.04))
      .on('tick', () => {
        linkSel
          .attr('x1', d => (d.source as SimNode).x ?? 0)
          .attr('y1', d => (d.source as SimNode).y ?? 0)
          .attr('x2', d => (d.target as SimNode).x ?? 0)
          .attr('y2', d => (d.target as SimNode).y ?? 0)
        nodeSel.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      })

    return () => { sim.stop() }
  }, [pillarFilter, userType, visibleNodes, visibleEdges])

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full">
      {/* Legend — bottom left */}
      <div className="absolute bottom-4 left-4 z-10 text-xs font-mono">
        {(Object.entries(NODE_COLOUR) as [NodeType, string][]).map(([type, colour]) => (
          <div key={type} className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: colour }} />
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>{type}</span>
          </div>
        ))}
      </div>

      <svg ref={svgRef} className="w-full h-full" style={{ background: '#0d2240' }} />

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none max-w-xs px-3 py-2 text-xs font-mono"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            background: 'rgba(13,34,64,0.97)',
            border: `1px solid ${NODE_COLOUR[tooltip.node.type]}`,
            color: '#fff',
            borderRadius: 2,
          }}
        >
          <div className="font-bold mb-1" style={{ color: NODE_COLOUR[tooltip.node.type] }}>
            {tooltip.node.label}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
            {tooltip.node.description}
          </div>
          {tooltip.node.contradictions.length > 0 && (
            <div className="mt-1" style={{ color: '#fac775' }}>
              ⚠ {tooltip.node.contradictions.length} known contradiction{tooltip.node.contradictions.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Node metadata panel */}
      {selected && (
        <div
          className="absolute right-0 z-20 overflow-y-auto"
          style={{
            top: '3.5rem',
            height: 'calc(100% - 3.5rem)',
            width: '17rem',
            background: 'rgba(10,25,50,0.97)',
            borderLeft: `1px solid ${NODE_COLOUR[selected.node.type]}`,
            borderTop: `1px solid ${NODE_COLOUR[selected.node.type]}33`,
          }}
        >
          <div className="p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="text-xs font-mono" style={{ color: NODE_COLOUR[selected.node.type], fontSize: 9, letterSpacing: 1 }}>
                    {selected.node.type}
                  </div>
                  <span
                    className="text-xs font-mono px-1.5 py-0.5"
                    style={{
                      background: selected.node.pillar === 'WASTE' ? 'rgba(29,158,117,0.2)' : selected.node.pillar === 'CLIMATE' ? 'rgba(55,138,221,0.2)' : 'rgba(250,199,117,0.2)',
                      color: selected.node.pillar === 'WASTE' ? '#1D9E75' : selected.node.pillar === 'CLIMATE' ? '#378ADD' : '#fac775',
                      border: '1px solid currentColor',
                      borderRadius: 1,
                      fontSize: 9,
                    }}
                  >
                    {selected.node.pillar}
                  </span>
                </div>
                <div className="text-xs font-mono font-bold" style={{ color: '#fff', lineHeight: 1.3 }}>
                  {selected.node.label}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-xs font-mono ml-2 shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>
                ✕
              </button>
            </div>

            <p className="text-xs leading-relaxed mb-3" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11 }}>
              {selected.node.description}
            </p>

            {Object.keys(selected.node.metadata).length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-mono tracking-wider mb-1.5" style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>
                  METADATA
                </div>
                {(Object.entries(selected.node.metadata) as [string, unknown][])
                  .filter(([k]) => !SKIP_META_KEYS.has(k))
                  .map(([key, value]) => (
                    <div key={key} className="mb-1.5">
                      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      </div>
                      <div style={{ color: '#fff', lineHeight: 1.4, fontSize: 11 }}>
                        {formatMetadataValue(value)}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {selected.node.contradictions.length > 0 && (
              <div className="mb-3 p-2" style={{ background: 'rgba(226,75,74,0.1)', border: '1px solid rgba(226,75,74,0.4)', borderRadius: 2 }}>
                <div className="font-mono mb-1" style={{ color: '#E24B4A', fontSize: 9 }}>⚠ CONTRADICTIONS</div>
                {selected.node.contradictions.map(cid => {
                  const cn = graphData.nodes.find(n => n.id === cid)
                  return cn ? (
                    <div key={cid} style={{ color: 'rgba(226,75,74,0.85)', fontSize: 11 }} className="mb-0.5">{cn.label}</div>
                  ) : null
                })}
              </div>
            )}

            <div className="font-mono mt-2" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9 }}>
              {selected.connectedIds.size - 1} direct connection{selected.connectedIds.size !== 2 ? 's' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
