import React from "react";
import ReactDOM from "react-dom/client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  Streamlit,
  StreamlitComponentBase,
  withStreamlitConnection,
} from "streamlit-component-lib";

/**
 * ---------- Pulsing CSS for breached Top Event ----------
 */

const PULSE_STYLE_ID = "bowtie-top-pulse-style";

function injectPulseCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PULSE_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = PULSE_STYLE_ID;
  style.innerHTML = `
    @keyframes bowtie-pulse-red {
      0% {
        box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.9);
      }
      70% {
        box-shadow: 0 0 0 16px rgba(248, 113, 113, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(248, 113, 113, 0);
      }
    }

    .rf-top-pulse {
      animation: bowtie-pulse-red 1.6s infinite;
    }
  `;
  document.head.appendChild(style);
}

/**
 * ---------- Metadata helpers ----------
 */

function ensureMeta(node) {
  if (!node.data) node.data = {};
  if (!node.data.meta) node.data.meta = {};
  const meta = node.data.meta;

  if (!meta.kind && typeof node.id === "string") {
    if (node.id.startsWith("hazard_")) meta.kind = "hazard";
    else if (node.id.startsWith("threat_")) meta.kind = "threat";
    else if (node.id.startsWith("conseq_")) meta.kind = "consequence";
    else if (node.id.startsWith("barrier_")) meta.kind = "barrier";
    else if (node.id.startsWith("center_")) meta.kind = "center";
  }

  if (meta.kind === "barrier") {
    if (!meta.barrierType) meta.barrierType = "preventive";
    if (meta.failed == null) meta.failed = false;
    if (!meta.barrierMedium) meta.barrierMedium = "human-hardware";
    if (!meta.responsibleParty) meta.responsibleParty = "Unassigned";
    if (meta.showMeta == null) meta.showMeta = true;
    if (meta.highlighted == null) meta.highlighted = false;
  }

  if (meta.kind === "hazard") {
    if (!meta.label) meta.label = "⚠ Hazard";
  }

  if (!node.data.baseLabel) {
    node.data.baseLabel = node.data.label || "";
  }

  if (meta.breached == null) {
    meta.breached = false;
  }
}

/**
 * For barriers: rebuild the visible label from meta + baseLabel in a structured way.
 */
function applyBarrierLabel(node) {
  if (!node.data || !node.data.meta) return;
  const meta = node.data.meta;
  const base = node.data.baseLabel || node.data.label || "";

  if (meta.showMeta === false) {
    node.data.label = base;
    return;
  }

  const mediumKey = meta.barrierMedium || "human-hardware";
  const responsible = meta.responsibleParty || "Unassigned";

  const mediumLineMap = {
    human: "Human",
    hardware: "Hardware",
    "human-hardware": "Human/Hardware",
  };

  const mediumLine = mediumLineMap[mediumKey] || String(mediumKey);
  const responsibleLine = `RP ${responsible}`;

  // nice-looking unicode divider
  const divider = "──────────────";

  node.data.label = `${base}\n${divider}\n${mediumLine}\n${responsibleLine}`;
}



/**
 * Collect all nodes+edges in the connected branch starting from a node.
 */
function collectBranch(startId, nodes, edges) {
  const nodesById = {};
  nodes.forEach((n) => {
    nodesById[n.id] = n;
  });

  // Find Top Event (center) node
  const centerCandidates = nodes.filter(
    (n) => typeof n.id === "string" && n.id.startsWith("center_")
  );
  const centerId =
    centerCandidates.length > 0
      ? centerCandidates[centerCandidates.length - 1].id
      : null;

  const nodeIds = new Set();
  const edgeIds = new Set();

  if (!startId || !nodesById[startId]) {
    return { nodeIds, edgeIds };
  }

  // Helper to reconstruct path from BFS parents map
  function buildPath(parents, from, to) {
    const path = [];
    let cur = to;
    while (cur != null) {
      path.push(cur);
      if (cur === from) break;
      cur = parents[cur];
    }
    return path.reverse();
  }

  // BFS in directed sense: either forward (source -> target)
  // or backward (target -> source)
  function bfsPath(sourceId, targetId, forward = true) {
    const queue = [sourceId];
    const seen = new Set([sourceId]);
    const parents = {};

    while (queue.length) {
      const cur = queue.shift();
      if (cur === targetId) {
        return buildPath(parents, sourceId, targetId);
      }

      for (const e of edges) {
        let next = null;
        if (forward && e.source === cur) {
          next = e.target;
        } else if (!forward && e.target === cur) {
          next = e.source;
        }

        if (!next || seen.has(next)) continue;
        seen.add(next);
        parents[next] = cur;
        queue.push(next);
      }
    }
    return null;
  }

  let path = null;

  if (centerId) {
    // Try from start → center following edge direction
    path = bfsPath(startId, centerId, true);

    // If that fails (e.g. on right-hand side), try reverse direction
    if (!path) {
      path = bfsPath(startId, centerId, false);
    }
  }

  if (path && path.length > 0) {
    // ✅ We found a path between the clicked node and the Top Event.
    // Highlight only this path.
    path.forEach((id) => nodeIds.add(id));

    edges.forEach((e) => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        if (
          (e.source === a && e.target === b) ||
          (e.source === b && e.target === a)
        ) {
          edgeIds.add(e.id);
          break;
        }
      }
    });

    return { nodeIds, edgeIds };
  }

  // ⚠️ Fallback: no path to Top Event → behave like old implementation
  const queue = [startId];
  nodeIds.add(startId);

  while (queue.length) {
    const cur = queue.shift();
    for (const e of edges) {
      if (e.source === cur || e.target === cur) {
        edgeIds.add(e.id);
        const other = e.source === cur ? e.target : e.source;
        if (!nodeIds.has(other)) {
          nodeIds.add(other);
          queue.push(other);
        }
      }
    }
  }

  return { nodeIds, edgeIds };
}

/**
 * Collapse consequence branches: hide all nodes & edges downstream of certain consequences.
 */
function applyConsequenceCollapse(nodesIn, edgesIn, collapsedConseqIds) {
  const nodes = (nodesIn || []).map((n) => ({ ...n }));
  const rawEdges = (edgesIn || []).map((e) => ({ ...e }));

  // Reset hidden flags each time
  nodes.forEach((n) => {
    n.hidden = false;
  });

  if (!collapsedConseqIds || collapsedConseqIds.length === 0) {
    return { nodes, edges: rawEdges };
  }

  const nodesById = {};
  nodes.forEach((n) => {
    nodesById[n.id] = n;
  });

  // Build adjacency (source -> outgoing edges)
  const outEdges = {};
  nodes.forEach((n) => {
    outEdges[n.id] = [];
  });
  rawEdges.forEach((e) => {
    if (outEdges[e.source]) outEdges[e.source].push(e);
  });

  // Find Top Event / center node
  const centerCandidates = nodes.filter(
    (n) => typeof n.id === "string" && n.id.startsWith("center_")
  );
  const centerId =
    centerCandidates.length > 0
      ? centerCandidates[centerCandidates.length - 1].id
      : null;

  const existingConseqs = (collapsedConseqIds || []).filter(
    (cid) => !!nodesById[cid]
  );
  const collapsedSet = new Set(existingConseqs);

  const hiddenNodeIds = new Set();
  let viewEdges = [...rawEdges];

  collapsedSet.forEach((conseqId) => {
    if (!centerId) return;

    const visited = new Set();
    const stack = [centerId];
    const localBarriers = new Set();
    let reachesConsequence = false;

    // Walk **from center outwards** toward this consequence,
    // collecting barrier nodes that sit on that path.
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);

      (outEdges[cur] || []).forEach((e) => {
        const tgt = e.target;
        if (typeof tgt !== "string") return;

        if (tgt.startsWith("barrier_")) {
          localBarriers.add(tgt);
          stack.push(tgt);
        } else if (tgt === conseqId) {
          reachesConsequence = true;
        } else {
          stack.push(tgt);
        }
      });
    }

    // Hide those barriers on the view side
    localBarriers.forEach((bid) => hiddenNodeIds.add(bid));

    // Add a synthetic shortcut edge center → consequence
    if (reachesConsequence) {
      const alreadyHas = viewEdges.some(
        (e) =>
          e.source === centerId &&
          e.target === conseqId &&
          e.data &&
          e.data.syntheticCollapse
      );
      if (!alreadyHas) {
        const conseqNode = nodesById[conseqId];
        const cMeta =
          conseqNode && conseqNode.data ? conseqNode.data.meta || {} : {};
        const breached = !!cMeta.breached;

        const collapseEdge = {
          id: `collapse_${centerId}_${conseqId}`,
          source: centerId,
          target: conseqId,
          // always use the right-side handle on Top Event
          sourceHandle: "right_out",
          type: "default",
          data: { syntheticCollapse: true },
        };

        if (breached) {
          collapseEdge.style = {
            stroke: "#f97373",
            strokeWidth: 3,
          };
          collapseEdge.animated = true;
        }

        viewEdges.push(collapseEdge);
      }
    }
  });

  // Apply hidden flags & filter edges that touch hidden nodes
  nodes.forEach((n) => {
    if (hiddenNodeIds.has(n.id)) {
      n.hidden = true;
    }
  });

  viewEdges = viewEdges.filter(
    (e) => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target)
  );

  return { nodes, edges: viewEdges };
}


/**
 * Core “breach” engine:
 * - If ALL barriers on a Threat → Top Event path are failed (or there are none),
 *   that path is breached: edges turn red, Threat + Top Event flagged.
 * - If Top Event is breached, propagate from center → Consequences:
 *   - Edges go red until they hit a mitigative barrier.
 *   - If mitigative barrier is active → block there.
 *   - If mitigative barrier failed → continue to Consequence and mark it red.
 * - Branch highlighting overlays styles on top of breach coloring.
 */
function computeFailureHighlights(nodesIn, edgesIn) {
  // Deep-ish clone nodes and edges so we don't mutate original references
  const nodes = (nodesIn || []).map((n) => ({
    ...n,
    hidden: false,
    data: {
      ...(n.data || {}),
      meta: { ...((n.data || {}).meta || {}) },
    },
    style: { ...(n.style || {}) },
    className: n.className || "",
  }));

  const edges = (edgesIn || []).map((e) => ({
    ...e,
    data: { ...(e.data || {}) },
    style: { ...(e.style || {}) },
  }));

  const nodesById = {};
  nodes.forEach((n) => {
    ensureMeta(n);
    // reset breach flag; will be recomputed
    n.data.meta.breached = false;
    nodesById[n.id] = n;
  });

  // Handle positions / handle sides
  nodes.forEach((n) => {
    if (typeof n.id !== "string") return;

    if (n.id.startsWith("barrier_")) {
      n.targetPosition = "left";
      n.sourcePosition = "right";
    }
    if (n.id.startsWith("threat_")) {
      n.sourcePosition = "right";
      n.targetPosition = "left";
    }
    if (n.id.startsWith("conseq_")) {
      n.targetPosition = "left";
      n.sourcePosition = "right";
    }
    if (n.id.startsWith("hazard_")) {
      // Hazards connect from bottom into the top of the Top Event
      n.sourcePosition = "bottom";
      n.type = "hazard";
    }
  });

  const centerCandidates = nodes.filter(
    (n) => typeof n.id === "string" && n.id.startsWith("center_")
  );
  const centerId =
    centerCandidates.length > 0
      ? centerCandidates[centerCandidates.length - 1].id
      : null;

  // Build adjacency
  const outEdges = {};
  edges.forEach((e) => {
    if (!outEdges[e.source]) outEdges[e.source] = [];
    outEdges[e.source].push(e);
  });

  // Reset all edge styling (we'll re-apply hot styling)
  edges.forEach((e) => {
    if (e.style) {
      const s = { ...e.style };
      delete s.stroke;
      delete s.strokeWidth;
      e.style = s;
    }
    e.animated = false;
  });

  const hotEdgeIds = new Set();
  const hotThreatIds = new Set();
  const hotConsequenceIds = new Set();
  let centerIsHot = false;

  // ---------- 1) Threat → Top Event breach detection ----------
  function processThreat(threatId) {
    let anyBreach = false;

    function dfs(currentId, pathEdgeIds, barrierIds, visited) {
      if (currentId === centerId) {
        // Evaluate this path: if no barriers OR all barriers failed → breach
        let allFailed = true;

        if (barrierIds.length > 0) {
          for (const bId of barrierIds) {
            const bNode = nodesById[bId];
            const bMeta = (bNode && bNode.data && bNode.data.meta) || {};
            if (!bMeta.failed) {
              allFailed = false;
              break;
            }
          }
        } else {
          // No barriers at all – treat as unprotected path
          allFailed = true;
        }

        if (allFailed) {
          anyBreach = true;
          pathEdgeIds.forEach((eid) => hotEdgeIds.add(eid));
          centerIsHot = true;
        }
        return;
      }

      const nextEdges = outEdges[currentId] || [];
      for (const e of nextEdges) {
        const nextId = e.target;
        if (!nextId || visited.has(nextId)) continue;

        const nextVisited = new Set(visited);
        nextVisited.add(nextId);

        let nextBarrierIds = barrierIds;
        if (typeof nextId === "string" && nextId.startsWith("barrier_")) {
          nextBarrierIds = [...barrierIds, nextId];
        }

        dfs(nextId, [...pathEdgeIds, e.id], nextBarrierIds, nextVisited);
      }
    }

    dfs(threatId, [], [], new Set([threatId]));

    if (anyBreach) {
      hotThreatIds.add(threatId);
    }
  }

  nodes.forEach((n) => {
    if (typeof n.id === "string" && n.id.startsWith("threat_")) {
      processThreat(n.id);
    }
  });

  // Mark threat→center edges hot
  edges.forEach((e) => {
    if (hotEdgeIds.has(e.id)) {
      e.style = {
        ...(e.style || {}),
        stroke: "#f97373",
        strokeWidth: 3,
      };
      e.animated = true;
    }
  });

  // ---------- 2) Center → Consequences (with mitigative barriers) ----------
  if (centerIsHot && centerId && nodesById[centerId]) {
    function dfsFromCenter(currentId, visited) {
      const nextEdges = outEdges[currentId] || [];
      for (const e of nextEdges) {
        const nextId = e.target;
        if (!nextId || visited.has(nextId)) continue;

        const nextNode = nodesById[nextId];
        if (!nextNode) continue;
        const meta = (nextNode.data && nextNode.data.meta) || {};

        const nextVisited = new Set(visited);
        nextVisited.add(nextId);

        const kind = meta.kind || "";
        const barrierType = meta.barrierType || "preventive";

        // Always color the edge from the current node if Top Event is breached
        hotEdgeIds.add(e.id);

        if (kind === "barrier" && barrierType === "mitigative") {
          // Threat reaches mitigative barrier; edge to barrier is hot.
          // If barrier failed, continue past it; if active, stop here.
          if (meta.failed) {
            dfsFromCenter(nextId, nextVisited);
          }
        } else if (kind === "consequence") {
          // Threat reaches consequence node → edge + consequence go red
          hotConsequenceIds.add(nextId);
          // Usually a sink; we can stop here.
        } else {
          // Other nodes – propagate further
          dfsFromCenter(nextId, nextVisited);
        }
      }
    }

    dfsFromCenter(centerId, new Set([centerId]));
  }

  // Apply all edge highlights (threat→center + center→consq)
  edges.forEach((e) => {
    if (hotEdgeIds.has(e.id)) {
      e.style = {
        ...(e.style || {}),
        stroke: "#f97373",
        strokeWidth: 3,
      };
      e.animated = true;
    }
  });

  // ---------- 3) Mark breached nodes in meta ----------
  hotThreatIds.forEach((tid) => {
    const tNode = nodesById[tid];
    if (!tNode || !tNode.data) return;
    const meta = tNode.data.meta || {};
    meta.breached = true;
    tNode.data.meta = meta;
  });

  if (centerIsHot && nodesById[centerId]) {
    const cMeta =
      (nodesById[centerId].data && nodesById[centerId].data.meta) || {};
    cMeta.breached = true;
    nodesById[centerId].data.meta = cMeta;
  }

  // Hazards feeding a breached Top Event become "breached" too
  if (centerIsHot && centerId) {
    edges.forEach((e) => {
      if (e.target === centerId) {
        const srcNode = nodesById[e.source];
        if (!srcNode || !srcNode.data || !srcNode.data.meta) return;
        if (srcNode.data.meta.kind === "hazard") {
          const hMeta = srcNode.data.meta;
          hMeta.breached = true;
          srcNode.data.meta = hMeta;
        }
      }
    });
  }

  hotConsequenceIds.forEach((cid) => {
    const cNode = nodesById[cid];
    if (!cNode || !cNode.data) return;
    const meta = cNode.data.meta || {};
    meta.breached = true;
    cNode.data.meta = meta;
  });

  // ---------- 4) Final styling for hazards, barriers, threats, center, consequences ----------
  nodes.forEach((n) => {
  const meta = n.data.meta || {};
  const kind = meta.kind || "";
  const baseStyle = n.style || {};

  if (kind === "hazard") {
    const baseText = n.data.baseLabel || n.data.label || "";

    if (meta.breached) {
      // Hazard associated with a breached Top Event – red-tinted stripes
      n.style = {
        ...baseStyle,
        background:
          "repeating-linear-gradient(45deg, #fecaca, #fecaca 8px, #7f1d1d 8px, #7f1d1d 16px)",
        border: "2px solid #b91c1c",
        color: "#7f1d1d",
        fontWeight: 700,
        textShadow:
          "0 0 2px rgba(255,255,255,1), \
          0 0 4px rgba(255,255,255,1), \
          0 0 8px rgba(255,255,255,1), \
          0 0 12px rgba(255,255,255,0.9)",
      };
    } else {
      // Normal hazard: yellow/black hazard stripes
      n.style = {
        ...baseStyle,
        background:
          "repeating-linear-gradient(45deg, #facc15, #facc15 8px, #000 8px, #000 16px)",
        border: "2px solid #000",
        color: "#000",
        fontWeight: 700,
        textShadow:
          "0 0 2px rgba(255,255,255,1), \
          0 0 4px rgba(255,255,255,1), \
          0 0 8px rgba(255,255,255,1), \
          0 0 12px rgba(255,255,255,0.9)",
      };
    }

    // keep the label as plain text so it can be serialized
    n.data = {
      ...(n.data || {}),
      label: baseText,
    };
      } else if (kind === "barrier") {
      const type = meta.barrierType || "preventive";

      // Common style so \n in the label become real line breaks
      const common = {
        ...baseStyle,
        whiteSpace: "pre-wrap",
        lineHeight: 1.25,
        fontSize: 11,
      };

      if (meta.failed) {
        // Failed barrier – strong red hint
        n.style = {
          ...common,
          border: "2px solid #f97373",
          background: "#111827",
          color: "#f9fafb",
        };
      } else {
        // Active barrier – visually differentiate preventive vs mitigative
        if (type === "preventive") {
          n.style = {
            ...common,
            border: "1px solid #22c55e",
            background: "#022c22",
            color: "#e5e7eb",
          };
        } else {
          // mitigative
          n.style = {
            ...common,
            border: "1px dashed #38bdf8",
            background: "#020617",
            color: "#e5e7eb",
          };
        }
      }
    } else if (kind === "center") {
      if (meta.breached) {
        // Breached Top Event: red + pulsating
        n.style = {
          ...baseStyle,
          background: "#fecaca",
          border: "2px solid #b91c1c",
          color: "#111827",
        };
        n.className = `${n.className || ""} rf-top-pulse`.trim();
      } else {
        // Safe Top Event: green
        n.style = {
          ...baseStyle,
          background: "#dcfce7",
          border: "2px solid #16a34a",
          color: "#064e3b",
        };
        // remove pulse class if it was there
        if (n.className) {
          n.className = n.className
            .split(" ")
            .filter((c) => c !== "rf-top-pulse")
            .join(" ");
        }
      }
    } else if (kind === "threat") {
      if (meta.breached) {
        // Breached threat: reddish
        n.style = {
          ...baseStyle,
          background: "#fee2e2",
          border: "1px solid #f97373",
          color: "#111827",
        };
      } else {
        // Normal threat: orangish
        n.style = {
          ...baseStyle,
          background: "#ffedd5",
          border: "1px solid #fb923c",
          color: "#7c2d12",
        };
      }
    } else if (kind === "consequence") {
      if (meta.breached) {
        // Breached consequence: red-ish
        n.style = {
          ...baseStyle,
          background: "#fecaca",
          border: "1px solid #b91c1c",
          color: "#111827",
        };
      } else {
        // Normal consequence: light blue
        n.style = {
          ...baseStyle,
          background: "#e0f2fe",
          border: "1px solid #38bdf8",
          color: "#0f172a",
        };
      }
    }
  });

    // ---------- 5) Branch highlighting via spotlight effect ----------
  const anyNodeHighlighted = nodes.some(
    (n) => n.data && n.data.meta && n.data.meta.highlighted
  );
  const anyEdgeHighlighted = edges.some(
    (e) => e.data && e.data.highlighted
  );
  const hasHighlight = anyNodeHighlighted || anyEdgeHighlighted;

  // Nodes: strongly spotlight highlighted, strongly dim everything else
  nodes.forEach((n) => {
    const meta = (n.data && n.data.meta) || {};
    const s = { ...(n.style || {}) };

    // clear any old outline / filter so we don’t stack effects
    delete s.outline;
    delete s.outlineOffset;
    delete s.filter;

    if (hasHighlight) {
      if (meta.highlighted) {
        // 🔵 bright outline around highlighted branch
        s.opacity = 1;
        s.outline = "2px solid rgba(59, 130, 246, 0.95)";
        s.outlineOffset = 2;
      } else {
        // everything else heavily faded + desaturated
        s.opacity = 0.15;
        s.filter = "grayscale(80%)";
      }
    } else {
      s.opacity = 1;
    }

    n.style = s;
  });

  // Edges: same idea – bright & thick for highlighted, faint for others
  edges.forEach((e) => {
    const highlighted = e.data && e.data.highlighted;
    const s = { ...(e.style || {}) };

    if (hasHighlight) {
      if (highlighted) {
        s.opacity = 1;
        s.strokeWidth = (s.strokeWidth || 2) + 1;
      } else {
        s.opacity = 0.15;
      }
    } else {
      s.opacity = 1;
    }

    e.style = s;
    // don't change e.animated here – breach logic already set it if needed
  });


  return { nodes, edges };
}

/**
 * Collapse engine: hide all downstream barriers and add synthetic Threat → Top Event edges.
 * If a threat has breached the Top Event, the synthetic edge stays red.
 */
function applyCollapse(nodesIn, edgesIn, collapsedThreatIds) {
  const nodes = (nodesIn || []).map((n) => ({ ...n }));
  const rawEdges = (edgesIn || []).map((e) => ({ ...e }));

  nodes.forEach((n) => {
    n.hidden = false;
  });

  if (!collapsedThreatIds || collapsedThreatIds.length === 0) {
    return { nodes, edges: rawEdges };
  }

  const nodesById = {};
  nodes.forEach((n) => {
    nodesById[n.id] = n;
  });

  const outEdges = {};
  nodes.forEach((n) => {
    outEdges[n.id] = [];
  });
  rawEdges.forEach((e) => {
    if (outEdges[e.source]) outEdges[e.source].push(e);
  });

  const centerCandidates = nodes.filter(
    (n) => typeof n.id === "string" && n.id.startsWith("center_")
  );
  const centerId =
    centerCandidates.length > 0
      ? centerCandidates[centerCandidates.length - 1].id
      : null;

  const existingThreats = (collapsedThreatIds || []).filter(
    (tid) => !!nodesById[tid]
  );
  const collapsedSet = new Set(existingThreats);

  const hiddenNodeIds = new Set();
  let viewEdges = [...rawEdges];

  collapsedSet.forEach((threatId) => {
    const visited = new Set();
    const stack = [threatId];
    const localBarriers = new Set();
    let reachesCenter = false;

    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);

      (outEdges[cur] || []).forEach((e) => {
        const tgt = e.target;
        if (typeof tgt !== "string") return;

        if (tgt.startsWith("barrier_")) {
          localBarriers.add(tgt);
          stack.push(tgt);
        } else if (tgt.startsWith("center_")) {
          reachesCenter = true;
        } else {
          stack.push(tgt);
        }
      });
    }

    localBarriers.forEach((bid) => hiddenNodeIds.add(bid));

    if (centerId && reachesCenter) {
      const alreadyHas = viewEdges.some(
        (e) =>
          e.source === threatId &&
          e.target === centerId &&
          e.data &&
          e.data.syntheticCollapse
      );
      if (!alreadyHas) {
        const threatNode = nodesById[threatId];
        const tMeta =
          threatNode && threatNode.data ? threatNode.data.meta || {} : {};
        const breached = !!tMeta.breached;

        const collapseEdge = {
          id: `collapse_${threatId}_${centerId}`,
          source: threatId,
          target: centerId,
          targetHandle: "left_in", 
          type: "default",
          data: { syntheticCollapse: true },
        };

        if (breached) {
          collapseEdge.style = {
            stroke: "#f97373",
            strokeWidth: 3,
          };
          collapseEdge.animated = true;
        }

        viewEdges.push(collapseEdge);
      }
    }
  });

  nodes.forEach((n) => {
    if (hiddenNodeIds.has(n.id)) {
      n.hidden = true;
    }
  });

  viewEdges = viewEdges.filter(
    (e) => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target)
  );

  return { nodes, edges: viewEdges };
}

const TopEventNode = ({ data, selected, style }) => {
  const label = data?.label || "🎯 Top Event";

  return (
    <div
      style={{
        ...style,
        padding: 10,
        borderRadius: 12,
        border: style?.border || "2px solid #555",
        background: style?.background || "#ffffff",
        color: style?.color || "#111827",
        minWidth: 140,
        textAlign: "center",
        position: "relative",
        boxShadow: selected
          ? "0 0 0 2px rgba(59,130,246,0.8)"
          : style?.boxShadow,
      }}
    >
      {/* Hazard input from above */}
      <Handle
        type="target"
        position={Position.Top}
        id="hazard_in"
        style={{ width: 8, height: 8 }}
      />

      {/* Threat / barrier input from the left */}
      <Handle
        type="target"
        position={Position.Left}
        id="left_in"
        style={{ width: 8, height: 8 }}
      />

      {/* Consequence / barrier output to the right */}
      <Handle
        type="source"
        position={Position.Right}
        id="right_out"
        style={{ width: 8, height: 8 }}
      />

      <div>{label}</div>
    </div>
  );
};

const HazardNode = ({ data, selected, style }) => {
  const label = data?.label || "⚠ Hazard";

  return (
    <div
      style={{
        ...style,
        padding: 8,
        borderRadius: 10,
        border: style?.border || "2px solid #000",
        background: style?.background ||
          "repeating-linear-gradient(45deg, #facc15, #facc15 8px, #000 8px, #000 16px)",
        color: style?.color || "#000",
        minWidth: 120,
        textAlign: "center",
        position: "relative",
        boxShadow: selected
          ? "0 0 0 2px rgba(59,130,246,0.8)"
          : style?.boxShadow,
        fontWeight: 700,
      }}
    >
      {/* ONLY a source handle on the bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="hazard_out"
        style={{ width: 8, height: 8 }}
      />

      <div>{label}</div>
    </div>
  );
};



/**
 * ---------- Main component ----------
 */

class BowtieFlowComponent extends StreamlitComponentBase {
  constructor(props) {
    super(props);

    this.state = {
      nodes: [],
      edges: [], // view edges for ReactFlow
      rawEdges: [], // canonical edges (structure)
      rfInstance: null,
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        position: { x: 0, y: 0 },
        kind: "threat",
        label: "",
        barrierType: "preventive",
        barrierMedium: "human-hardware",
        responsibleParty: "Unassigned",
      },
      editPanel: {
        visible: false,
        nodeId: null,
        kind: "",
        label: "",
        barrierType: "preventive",
        barrierMedium: "human-hardware",
        responsibleParty: "Unassigned",
        failed: false,
      },
      collapsedThreats: [],
      collapsedConsequences: [],
      nodeMenu: {
        visible: false,
        x: 0,
        y: 0,
        nodeId: null,
        canCollapse: false,
        isCollapsed: false,
        isBarrier: false,
        barrierFailed: false,
        barrierShowMeta: true,
        isConsequence: false,
        consequenceCollapsed: false,
        isHazard: false,
      },
      edgeMenu: {
        visible: false,
        x: 0,
        y: 0,
        edgeId: null,
        canDelete: true,
        isSynthetic: false,
        canInsert: false,
        insertPosition: null,
        sourceId: null,
        targetId: null,
      },
      // tracks when we're inserting a barrier into an existing edge
      pendingInsertFromEdge: null,
    };

    this.syncFromProps = this.syncFromProps.bind(this);
    this.pushToStreamlit = this.pushToStreamlit.bind(this);
    this.onNodesChange = this.onNodesChange.bind(this);
    this.onEdgesChange = this.onEdgesChange.bind(this);
    this.onConnect = this.onConnect.bind(this);
    this.onInit = this.onInit.bind(this);
    this.onPaneContextMenu = this.onPaneContextMenu.bind(this);
    this.onPaneClick = this.onPaneClick.bind(this);
    this.handleMenuFieldChange = this.handleMenuFieldChange.bind(this);
    this.handleAddNodeFromMenu = this.handleAddNodeFromMenu.bind(this);
    this.handleCancelMenu = this.handleCancelMenu.bind(this);

    this.onNodeDoubleClick = this.onNodeDoubleClick.bind(this);
    this.handleEditFieldChange = this.handleEditFieldChange.bind(this);
    this.handleEditCancel = this.handleEditCancel.bind(this);
    this.handleEditSave = this.handleEditSave.bind(this);

    this.recalcNodes = this.recalcNodes.bind(this);
    this.onNodeContextMenu = this.onNodeContextMenu.bind(this);
    this.handleNodeMenuAction = this.handleNodeMenuAction.bind(this);
    this.handleNodeMenuClose = this.handleNodeMenuClose.bind(this);

    this.onEdgeContextMenu = this.onEdgeContextMenu.bind(this);
    this.handleEdgeMenuClose = this.handleEdgeMenuClose.bind(this);
    this.handleEdgeDelete = this.handleEdgeDelete.bind(this);
    this.handleEdgeInsertNode = this.handleEdgeInsertNode.bind(this);

    this.toggleBranchHighlight = this.toggleBranchHighlight.bind(this);
  }

  componentDidMount() {
    injectPulseCss();
    this.syncFromProps();
  }

  recalcNodes(rawNodes, rawEdges, collapsedOverride, collapsedConsqOverride) {
    const collapsedThreats =
      collapsedOverride !== undefined && collapsedOverride !== null
        ? collapsedOverride
        : this.state.collapsedThreats;

    const collapsedConsequences =
      collapsedConsqOverride !== undefined && collapsedConsqOverride !== null
        ? collapsedConsqOverride
        : this.state.collapsedConsequences;

    const annotated = computeFailureHighlights(rawNodes, rawEdges);

    const afterThreatCollapse =
      !collapsedThreats || collapsedThreats.length === 0
        ? { nodes: annotated.nodes, edges: annotated.edges }
        : applyCollapse(annotated.nodes, annotated.edges, collapsedThreats);

    const afterConseqCollapse = applyConsequenceCollapse(
      afterThreatCollapse.nodes,
      afterThreatCollapse.edges,
      collapsedConsequences
    );

    return { nodes: afterConseqCollapse.nodes, edges: afterConseqCollapse.edges };
  }

  syncFromProps() {
    const { nodes: nodesJson, edges: edgesJson, height } = this.props.args;

    let nodes = [];
    let edges = [];

    try {
      nodes = nodesJson ? JSON.parse(nodesJson) : [];
      edges = edgesJson ? JSON.parse(edgesJson) : [];
    } catch (err) {
      console.error("Failed to parse nodes/edges from Python:", err);
    }

    const processed = this.recalcNodes(nodes, edges);

    this.setState(
      (state) => ({
        ...state,
        nodes: processed.nodes,
        edges: processed.edges,
        rawEdges: edges,
      }),
      () => {
        this.pushToStreamlit();
        if (height) {
          Streamlit.setFrameHeight(height);
        }
      }
    );
  }

  pushToStreamlit() {
    const { nodes, rawEdges } = this.state;
    Streamlit.setComponentValue({ nodes, edges: rawEdges });
  }

  onNodesChange(changes) {
    this.setState(
      (state) => {
        const updatedNodes = applyNodeChanges(changes, state.nodes);
        const processed = this.recalcNodes(updatedNodes, state.rawEdges);
        return { ...state, nodes: processed.nodes, edges: processed.edges };
      },
      this.pushToStreamlit
    );
  }

  onEdgesChange(changes) {
    this.setState(
      (state) => {
        const updatedRawEdges = applyEdgeChanges(changes, state.rawEdges);
        const processed = this.recalcNodes(state.nodes, updatedRawEdges);
        return {
          ...state,
          nodes: processed.nodes,
          edges: processed.edges,
          rawEdges: updatedRawEdges,
        };
      },
      this.pushToStreamlit
    );
  }

  onConnect(connection) {
    this.setState(
      (state) => {
        const newRawEdges = addEdge(
          { ...connection, type: "default" },
          state.rawEdges
        );
        const processed = this.recalcNodes(state.nodes, newRawEdges);
        return {
          ...state,
          nodes: processed.nodes,
          edges: processed.edges,
          rawEdges: newRawEdges,
        };
      },
      this.pushToStreamlit
    );
  }

  onInit(instance) {
    this.setState({ rfInstance: instance }, () => {
      const { height } = this.props.args;
      if (height) {
        Streamlit.setFrameHeight(height);
      }
    });
  }

  // ---------- Pane context menu ----------

  onPaneContextMenu(event) {
    event.preventDefault();
    const { rfInstance } = this.state;
    if (!rfInstance) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const flowPos = rfInstance.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });

    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;

    this.setState((state) => ({
      ...state,
      contextMenu: {
        ...state.contextMenu,
        visible: true,
        x: localX,
        y: localY,
        position: flowPos,
        label: "",
        kind: "threat",
        barrierType: "preventive",
        barrierMedium: "human-hardware",
        responsibleParty: "Unassigned",
      },
      nodeMenu: { ...state.nodeMenu, visible: false },
      edgeMenu: { ...state.edgeMenu, visible: false },
    }));
  }

  onPaneClick() {
    let changed = false;
    this.setState((state) => {
      const newState = { ...state };
      if (state.contextMenu.visible) {
        newState.contextMenu = { ...state.contextMenu, visible: false };
        changed = true;
      }
      if (state.nodeMenu.visible) {
        newState.nodeMenu = { ...state.nodeMenu, visible: false };
        changed = true;
      }
      if (state.edgeMenu.visible) {
        newState.edgeMenu = { ...state.edgeMenu, visible: false };
        changed = true;
      }
      return newState;
    });
    if (changed) this.pushToStreamlit();
  }

  handleMenuFieldChange(field, value) {
    this.setState((state) => ({
      ...state,
      contextMenu: { ...state.contextMenu, [field]: value },
    }));
  }

  handleCancelMenu() {
    this.setState((state) => ({
      ...state,
      contextMenu: { ...state.contextMenu, visible: false },
      pendingInsertFromEdge: null,
    }));
  }

  handleAddNodeFromMenu() {
    const {
      position,
      kind,
      label,
      barrierType,
      barrierMedium,
      responsibleParty,
    } = this.state.contextMenu;

    const trimmed = label.trim();
    const displayLabel = trimmed || "New node";

    let idPrefix = "node";
    let baseLabel = displayLabel;
    let meta = {};

    if (kind === "threat") {
      idPrefix = "threat";
      baseLabel = `⚠ Threat: ${displayLabel}`;
      meta = {
        kind: "threat",
      };
    } else if (kind === "consequence") {
      idPrefix = "conseq";
      baseLabel = `❗ Consequence: ${displayLabel}`;
      meta = {
        kind: "consequence",
      };
    } else if (kind === "barrier") {
      idPrefix = "barrier";
      baseLabel = `🛡 Barrier: ${displayLabel}`;
      meta = {
        kind: "barrier",
        barrierType,
        barrierMedium,
        responsibleParty: responsibleParty || "Unassigned",
        failed: false,
        showMeta: true,
      };
    } else if (kind === "center") {
      idPrefix = "center";
      baseLabel = `🎯 ${displayLabel}`;
      meta = {
        kind: "center",
      };
    } else if (kind === "hazard") {
      idPrefix = "hazard";
      baseLabel = `⚠ Hazard: ${displayLabel}`;
      meta = {
        kind: "hazard",
      };
    }

    const newNodeId = `${idPrefix}_${Date.now()}`;
    const nodeType = kind === "center" ? "topEvent" : kind === "hazard" ? "hazard" : "default";

    const newNode = {
      id: newNodeId,
      position,
      data: {
        label: baseLabel,
        baseLabel: baseLabel,
        meta: meta,
      },
      type: nodeType,
    };

    // Special styling for Hazard node (initial; will be refined in computeFailureHighlights)
    if (kind === "hazard") {
      newNode.style = {
        background:
          "repeating-linear-gradient(45deg, #facc15, #facc15 8px, #000 8px, #000 16px)",
        border: "2px solid #000",
        color: "#000",
        padding: 8,
        borderRadius: 10,
      };
    }

    // Initialize barrier label with metadata lines
    if (kind === "barrier") {
      applyBarrierLabel(newNode);
    }

    this.setState(
      (state) => {
        let updatedNodes = [...state.nodes, newNode];
        let updatedRawEdges = state.rawEdges;

        // Automatically connect Hazard → Top Event
        if (kind === "hazard") {
          const center = state.nodes.find((n) =>
            String(n.id).startsWith("center_")
          );
          if (center) {
            const edge = {
              id: `edge_${newNodeId}_${center.id}`,
              source: newNodeId,
              target: center.id,
              targetHandle: "hazard_in",
              type: "default",
              style: { stroke: "#000", strokeWidth: 2 },
            };
            updatedRawEdges = [...updatedRawEdges, edge];
          }
        }

        // If we are inserting this barrier into an existing edge, split that edge
        if (
          state.pendingInsertFromEdge &&
          kind === "barrier" // only edge-insert makes sense for a barrier
        ) {
          const { edgeId, sourceId, targetId } = state.pendingInsertFromEdge;

          const oldEdge = updatedRawEdges.find((e) => e.id === edgeId);
          updatedRawEdges = updatedRawEdges.filter((e) => e.id !== edgeId);

          const edgeBase = oldEdge || { type: "default" };

          const edge1 = {
            ...edgeBase,
            id: `${edgeId}_a_${Date.now()}`,
            source: sourceId,
            target: newNodeId,
          };
          const edge2 = {
            ...edgeBase,
            id: `${edgeId}_b_${Date.now()}`,
            source: newNodeId,
            target: targetId,
          };

          // remove syntheticCollapse flag from new edges if present
          if (edge1.data && edge1.data.syntheticCollapse) {
            edge1.data = { ...edge1.data };
            delete edge1.data.syntheticCollapse;
          }
          if (edge2.data && edge2.data.syntheticCollapse) {
            edge2.data = { ...edge2.data };
            delete edge2.data.syntheticCollapse;
          }

          updatedRawEdges = [...updatedRawEdges, edge1, edge2];
        }

        const processed = this.recalcNodes(
          updatedNodes,
          updatedRawEdges,
          undefined,
          undefined
        );
        return {
          ...state,
          nodes: processed.nodes,
          edges: processed.edges,
          rawEdges: updatedRawEdges,
          contextMenu: { ...state.contextMenu, visible: false },
          pendingInsertFromEdge: null,
        };
      },
      this.pushToStreamlit
    );
  }

  renderContextMenu() {
    const { contextMenu } = this.state;
    if (!contextMenu.visible) return null;

    const menuStyle = {
      position: "absolute",
      left: contextMenu.x,
      top: contextMenu.y,
      background: "#1f2933",
      color: "white",
      padding: "8px 10px",
      borderRadius: "8px",
      boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
      zIndex: 10,
      minWidth: "250px",
      fontSize: "0.85rem",
      border: "1px solid rgba(255,255,255,0.08)",
    };

    const inputStyle = {
      width: "100%",
      marginTop: "4px",
      marginBottom: "6px",
      padding: "3px 6px",
      fontSize: "0.85rem",
    };

    return (
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>Add node</div>

        <label style={{ display: "block", marginTop: "4px" }}>
          Type
          <select
            style={inputStyle}
            value={contextMenu.kind}
            onChange={(e) =>
              this.handleMenuFieldChange("kind", e.target.value)
            }
          >
            <option value="threat">Threat</option>
            <option value="barrier">Barrier</option>
            <option value="hazard">Hazard</option>
            <option value="consequence">Consequence</option>
            <option value="center">Top Event</option>
          </select>
        </label>

        <label style={{ display: "block", marginTop: "4px" }}>
          Label
          <input
            style={inputStyle}
            type="text"
            value={contextMenu.label}
            placeholder="e.g., Overpressure, PSV, Injury..."
            onChange={(e) =>
              this.handleMenuFieldChange("label", e.target.value)
            }
          />
        </label>

        {contextMenu.kind === "barrier" && (
          <>
            <label style={{ display: "block", marginTop: "4px" }}>
              Barrier type
              <select
                style={inputStyle}
                value={contextMenu.barrierType}
                onChange={(e) =>
                  this.handleMenuFieldChange("barrierType", e.target.value)
                }
              >
                <option value="preventive">Preventive</option>
                <option value="mitigative">Mitigative</option>
              </select>
            </label>

            <label style={{ display: "block", marginTop: "4px" }}>
              Medium
              <select
                style={inputStyle}
                value={contextMenu.barrierMedium}
                onChange={(e) =>
                  this.handleMenuFieldChange("barrierMedium", e.target.value)
                }
              >
                <option value="human">Human</option>
                <option value="hardware">Hardware</option>
                <option value="human-hardware">Human–Hardware</option>
              </select>
            </label>

            <label style={{ display: "block", marginTop: "4px" }}>
              Responsible Party
              <input
                style={inputStyle}
                type="text"
                value={contextMenu.responsibleParty || ""}
                placeholder="e.g., Maintenance Engineer"
                onChange={(e) =>
                  this.handleMenuFieldChange(
                    "responsibleParty",
                    e.target.value
                  )
                }
              />
            </label>
          </>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "6px",
            marginTop: "6px",
          }}
        >
          <button
            style={{
              padding: "3px 8px",
              fontSize: "0.8rem",
              background: "#374151",
              border: "none",
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
            }}
            onClick={this.handleCancelMenu}
          >
            Cancel
          </button>
          <button
            style={{
              padding: "3px 8px",
              fontSize: "0.8rem",
              background: "#10b981",
              border: "none",
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
            }}
            onClick={this.handleAddNodeFromMenu}
          >
            Add node
          </button>
        </div>
      </div>
    );
  }

  // ---------- Edit panel (double-click node) ----------
  onNodeDoubleClick(event, node) {
    
    event.stopPropagation();
    console.log("Double-clicked node:", node.id, node.data?.meta?.kind);

    const meta = (node.data && node.data.meta) || {};
    let kind = meta.kind;
    if (!kind && typeof node.id === "string") {
      if (node.id.startsWith("hazard_")) kind = "hazard";
      else if (node.id.startsWith("threat_")) kind = "threat";
      else if (node.id.startsWith("conseq_")) kind = "consequence";
      else if (node.id.startsWith("barrier_")) kind = "barrier";
      else if (node.id.startsWith("center_")) kind = "center";
    }

    const baseLabel = node.data.baseLabel || node.data.label || "";
    const cleaned = baseLabel
      .replace(/^⚠ Hazard:\s*/i, "")
      .replace(/^⚠ Threat:\s*/i, "")
      .replace(/^❗ Consequence:\s*/i, "")
      .replace(/^🛡 Barrier:\s*/i, "")
      .replace(/^🎯\s*/, "");

    const barrierType = meta.barrierType || "preventive";
    const barrierMedium = meta.barrierMedium || "human-hardware";
    const responsibleParty = meta.responsibleParty || "Unassigned";
    const failed = !!meta.failed;

    this.setState((state) => ({
      ...state,
      editPanel: {
        visible: true,
        nodeId: node.id,
        kind: kind || "node",
        label: cleaned,
        barrierType,
        barrierMedium,
        responsibleParty,
        failed,
      },
    }));
  }

  handleEditFieldChange(field, value) {
    this.setState((state) => ({
      ...state,
      editPanel: { ...state.editPanel, [field]: value },
    }));
  }

  handleEditCancel() {
    this.setState((state) => ({
      ...state,
      editPanel: { ...state.editPanel, visible: false },
    }));
  }

  handleEditSave() {
    this.setState(
      (state) => {
        const {
          nodeId,
          kind,
          label,
          barrierType,
          barrierMedium,
          responsibleParty,
          failed,
        } = state.editPanel;

        const cleanedLabel = label.trim() || "Node";

        const updatedNodes = state.nodes.map((n) => {
          if (n.id !== nodeId) return n;

          const meta = { ...((n.data && n.data.meta) || {}) };
          let baseLabel = cleanedLabel;

          if (kind === "hazard") {
            baseLabel = `⚠ Hazard: ${cleanedLabel}`;
            meta.kind = "hazard";
          } else if (kind === "threat") {
            baseLabel = `⚠ Threat: ${cleanedLabel}`;
            meta.kind = "threat";
          } else if (kind === "consequence") {
            baseLabel = `❗ Consequence: ${cleanedLabel}`;
            meta.kind = "consequence";
          } else if (kind === "barrier") {
            baseLabel = `🛡 Barrier: ${cleanedLabel}`;
            meta.kind = "barrier";
            meta.barrierType = barrierType;
            meta.barrierMedium = barrierMedium || "human-hardware";
            meta.responsibleParty =
              responsibleParty && responsibleParty.trim().length
                ? responsibleParty.trim()
                : "Unassigned";
            meta.failed = !!failed;
          } else if (kind === "center") {
            baseLabel = `🎯 ${cleanedLabel}`;
            meta.kind = "center";
          }

          const newData = {
            ...(n.data || {}),
            baseLabel,
            label: baseLabel,
            meta,
          };

          const updatedNode = { ...n, data: newData };

          if (kind === "barrier") {
            applyBarrierLabel(updatedNode);
          }

          return updatedNode;
        });

        const processed = this.recalcNodes(
          updatedNodes,
          state.rawEdges,
          undefined,
          undefined
        );

        return {
          ...state,
          nodes: processed.nodes,
          edges: processed.edges,
          editPanel: { ...state.editPanel, visible: false },
        };
      },
      this.pushToStreamlit
    );
  }

  renderEditPanel() {
  const { editPanel } = this.state;
  if (!editPanel.visible) return null;

  const panelStyle = {
    position: "absolute",
    top: 12,
    right: 12,
    background: "#111827",
    color: "white",
    padding: "10px 12px",
    borderRadius: "10px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.45)",
    zIndex: 20,
    width: "260px",
    fontSize: "0.85rem",
    border: "1px solid rgba(255,255,255,0.12)",
  };

  const inputStyle = {
    width: "100%",
    marginTop: "4px",
    marginBottom: "6px",
    padding: "3px 6px",
    fontSize: "0.85rem",
  };

  return (
    <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>Edit node</div>

      {/* Label (for all node types) */}
      <label style={{ display: "block", marginTop: "4px" }}>
        Label
        <input
          style={inputStyle}
          type="text"
          value={editPanel.label}
          onChange={(e) =>
            this.handleEditFieldChange("label", e.target.value)
          }
        />
      </label>

      {/* Barrier-specific metadata */}
      {editPanel.kind === "barrier" && (
        <>
          <label style={{ display: "block", marginTop: "4px" }}>
            Barrier type
            <select
              style={inputStyle}
              value={editPanel.barrierType}
              onChange={(e) =>
                this.handleEditFieldChange("barrierType", e.target.value)
              }
            >
              <option value="preventive">Preventive</option>
              <option value="mitigative">Mitigative</option>
            </select>
          </label>

          <label style={{ display: "block", marginTop: "4px" }}>
            Medium
            <select
              style={inputStyle}
              value={editPanel.barrierMedium}
              onChange={(e) =>
                this.handleEditFieldChange("barrierMedium", e.target.value)
              }
            >
              <option value="human">Human</option>
              <option value="hardware">Hardware</option>
              <option value="human-hardware">Human–Hardware</option>
            </select>
          </label>

          <label style={{ display: "block", marginTop: "4px" }}>
            Responsible Party
            <input
              style={inputStyle}
              type="text"
              value={editPanel.responsibleParty || ""}
              onChange={(e) =>
                this.handleEditFieldChange(
                  "responsibleParty",
                  e.target.value
                )
              }
            />
          </label>

          <label style={{ display: "block", marginTop: "4px" }}>
            Status
            <select
              style={inputStyle}
              value={editPanel.failed ? "failed" : "active"}
              onChange={(e) =>
                this.handleEditFieldChange(
                  "failed",
                  e.target.value === "failed"
                )
              }
            >
              <option value="active">Active (working)</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        </>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "6px",
          marginTop: "8px",
        }}
      >
        <button
          style={{
            padding: "3px 8px",
            fontSize: "0.8rem",
            background: "#374151",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
          }}
          onClick={this.handleEditCancel}
        >
          Cancel
        </button>
        <button
          style={{
            padding: "3px 8px",
            fontSize: "0.8rem",
            background: "#3b82f6",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
          }}
          onClick={this.handleEditSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}


  // ---------- Node context menu (collapse / delete / barrier actions) ----------

  onNodeContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();

    const { rawEdges, collapsedThreats, collapsedConsequences, nodes } =
      this.state;

    const wrapper = document.getElementById("root");
    const bounds = wrapper
      ? wrapper.getBoundingClientRect()
      : { left: 0, top: 0 };
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;

    const isThreat =
      typeof node.id === "string" && node.id.startsWith("threat_");
    const isBarrier =
      typeof node.id === "string" && node.id.startsWith("barrier_");
    const isConsequence =
      typeof node.id === "string" && node.id.startsWith("conseq_");
    const isHazard =
      typeof node.id === "string" && node.id.startsWith("hazard_");

    const centerCandidates = nodes.filter(
      (n) => typeof n.id === "string" && n.id.startsWith("center_")
    );
    const centerId =
      centerCandidates.length > 0
        ? centerCandidates[centerCandidates.length - 1].id
        : null;

    let canCollapseThreat = false;

    if (isThreat && centerId) {
      const visited = new Set();
      const stack = [node.id];
      let hasBarrier = false;
      let reachesCenter = false;

      while (stack.length > 0) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);

        rawEdges.forEach((e) => {
          if (e.source === cur) {
            const tgt = e.target;
            if (typeof tgt !== "string") return;

            if (tgt.startsWith("barrier_")) {
              hasBarrier = true;
            }
            if (tgt === centerId) {
              reachesCenter = true;
            }
            stack.push(tgt);
          }
        });
      }

      canCollapseThreat = hasBarrier && reachesCenter;
    }

    const isCollapsedThreat = collapsedThreats.includes(node.id);
    const consequenceCollapsed = collapsedConsequences.includes(node.id);

    const barrierFailed =
      isBarrier && node.data && node.data.meta
        ? !!node.data.meta.failed
        : false;
    const barrierShowMeta =
      isBarrier && node.data && node.data.meta
        ? node.data.meta.showMeta !== false
        : true;

    this.setState((state) => ({
      ...state,
      nodeMenu: {
        ...state.nodeMenu,
        visible: true,
        x: localX,
        y: localY,
        nodeId: node.id,
        canCollapse: canCollapseThreat,
        isCollapsed: isCollapsedThreat,
        isBarrier,
        barrierFailed,
        barrierShowMeta,
        isConsequence,
        consequenceCollapsed,
        isHazard,
      },
      contextMenu: { ...state.contextMenu, visible: false },
      edgeMenu: { ...state.edgeMenu, visible: false },
    }));
  }


  handleNodeMenuClose() {
    this.setState((state) => ({
      ...state,
      nodeMenu: { ...state.nodeMenu, visible: false },
    }));
  }

  handleNodeMenuAction(action) {
    if (action === "editNode") {
      const nodeId = this.state.nodeMenu.nodeId;
      if (!nodeId) return;

      const node = this.state.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const meta = (node.data && node.data.meta) || {};
      let kind = meta.kind;
      if (!kind && typeof node.id === "string") {
        if (node.id.startsWith("hazard_")) kind = "hazard";
        else if (node.id.startsWith("threat_")) kind = "threat";
        else if (node.id.startsWith("conseq_")) kind = "consequence";
        else if (node.id.startsWith("barrier_")) kind = "barrier";
        else if (node.id.startsWith("center_")) kind = "center";
      }

      const baseLabel = node.data.baseLabel || node.data.label || "";
      const cleaned = baseLabel
        .replace(/^⚠ Hazard:\s*/i, "")
        .replace(/^⚠ Threat:\s*/i, "")
        .replace(/^❗ Consequence:\s*/i, "")
        .replace(/^🛡 Barrier:\s*/i, "")
        .replace(/^🎯\s*/, "");

      const barrierType = meta.barrierType || "preventive";
      const barrierMedium = meta.barrierMedium || "human-hardware";
      const responsibleParty = meta.responsibleParty || "Unassigned";
      const failed = !!meta.failed;

      this.setState((state) => ({
        ...state,
        editPanel: {
          visible: true,
          nodeId: node.id,
          kind: kind || "node",
          label: cleaned,
          barrierType,
          barrierMedium,
          responsibleParty,
          failed,
        },
        nodeMenu: { ...state.nodeMenu, visible: false },
      }));
      return;
    }

    if (action === "toggleCollapse") {
      this.setState(
        (state) => {
          const nodeId = state.nodeMenu.nodeId;
          if (!nodeId) return state;

          // Clear highlight flags
          const clearedNodes = state.nodes.map((n) => {
            const meta = { ...((n.data && n.data.meta) || {}) };
            if (meta.highlighted) {
              meta.highlighted = false;
            }
            return {
              ...n,
              data: {
                ...(n.data || {}),
                meta,
              },
            };
          });

          const clearedRawEdges = state.rawEdges.map((e) => {
            const data = { ...(e.data || {}) };
            if (data.highlighted) {
              delete data.highlighted;
            }
            return { ...e, data };
          });

          let nextCollapsed = state.collapsedThreats || [];
          const idx = nextCollapsed.indexOf(nodeId);
          if (idx >= 0) {
            nextCollapsed = [
              ...nextCollapsed.slice(0, idx),
              ...nextCollapsed.slice(idx + 1),
            ];
          } else {
            nextCollapsed = [...nextCollapsed, nodeId];
          }

          const processed = this.recalcNodes(
            clearedNodes,
            clearedRawEdges,
            nextCollapsed,
            undefined
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            rawEdges: clearedRawEdges,
            collapsedThreats: nextCollapsed,
            nodeMenu: { ...state.nodeMenu, visible: false },
          };
        },
        this.pushToStreamlit
      );
    } else if (action === "toggleConsequenceCollapse") {
      this.setState(
        (state) => {
          const nodeId = state.nodeMenu.nodeId;
          if (!nodeId) return state;

          const clearedNodes = state.nodes.map((n) => {
            const meta = { ...((n.data && n.data.meta) || {}) };
            if (meta.highlighted) {
              meta.highlighted = false;
            }
            return {
              ...n,
              data: {
                ...(n.data || {}),
                meta,
              },
            };
          });

          const clearedRawEdges = state.rawEdges.map((e) => {
            const data = { ...(e.data || {}) };
            if (data.highlighted) {
              delete data.highlighted;
            }
            return { ...e, data };
          });

          let nextCollapsed = state.collapsedConsequences || [];
          const idx = nextCollapsed.indexOf(nodeId);
          if (idx >= 0) {
            nextCollapsed = [
              ...nextCollapsed.slice(0, idx),
              ...nextCollapsed.slice(idx + 1),
            ];
          } else {
            nextCollapsed = [...nextCollapsed, nodeId];
          }

          const processed = this.recalcNodes(
            clearedNodes,
            clearedRawEdges,
            undefined,
            nextCollapsed
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            rawEdges: clearedRawEdges,
            collapsedConsequences: nextCollapsed,
            nodeMenu: { ...state.nodeMenu, visible: false },
          };
        },
        this.pushToStreamlit
      );
    } else if (action === "deleteNode") {
      this.setState(
        (state) => {
          const nodeId = state.nodeMenu.nodeId;
          if (!nodeId) return state;

          const nextNodes = state.nodes.filter((n) => n.id !== nodeId);
          const nextRawEdges = state.rawEdges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId
          );
          const nextCollapsedThreats = (state.collapsedThreats || []).filter(
            (id) => id !== nodeId
          );
          const nextCollapsedConsequences = (
            state.collapsedConsequences || []
          ).filter((id) => id !== nodeId);

          const processed = this.recalcNodes(
            nextNodes,
            nextRawEdges,
            nextCollapsedThreats,
            nextCollapsedConsequences
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            rawEdges: nextRawEdges,
            collapsedThreats: nextCollapsedThreats,
            collapsedConsequences: nextCollapsedConsequences,
            nodeMenu: { ...state.nodeMenu, visible: false },
          };
        },
        this.pushToStreamlit
      );
    } else if (action === "toggleBarrierFailed") {
      this.setState(
        (state) => {
          const nodeId = state.nodeMenu.nodeId;
          if (!nodeId) return state;

          const updatedNodes = state.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const meta = { ...((n.data && n.data.meta) || {}) };
            meta.kind = meta.kind || "barrier";
            meta.failed = !meta.failed;
            const data = { ...(n.data || {}), meta };
            return { ...n, data };
          });

          const processed = this.recalcNodes(
            updatedNodes,
            state.rawEdges,
            undefined,
            undefined
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            nodeMenu: { ...state.nodeMenu, visible: false },
          };
        },
        this.pushToStreamlit
      );
    } else if (action === "toggleBarrierMeta") {
      this.setState(
        (state) => {
          const nodeId = state.nodeMenu.nodeId;
          if (!nodeId) return state;

          const updatedNodes = state.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            const meta = { ...((n.data && n.data.meta) || {}) };
            meta.kind = meta.kind || "barrier";
            meta.showMeta = meta.showMeta === false ? true : false;
            const updated = {
              ...n,
              data: {
                ...(n.data || {}),
                meta,
              },
            };
            applyBarrierLabel(updated);
            return updated;
          });

          const processed = this.recalcNodes(
            updatedNodes,
            state.rawEdges,
            undefined,
            undefined
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            nodeMenu: { ...state.nodeMenu, visible: false },
          };
        },
        this.pushToStreamlit
      );
    } else if (action === "highlightBranch") {
      const nodeId = this.state.nodeMenu.nodeId;
      if (nodeId) {
        this.toggleBranchHighlight(nodeId);
      }
      this.handleNodeMenuClose();
    }
  }


  renderNodeMenu() {
    const { nodeMenu } = this.state;
    if (!nodeMenu.visible) return null;

    const menuStyle = {
      position: "absolute",
      left: nodeMenu.x,
      top: nodeMenu.y,
      background: "#111827",
      color: "white",
      padding: "8px 10px",
      borderRadius: "8px",
      boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
      zIndex: 15,
      minWidth: "220px",
      fontSize: "0.85rem",
      border: "1px solid rgba(255,255,255,0.08)",
    };

    return (
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>
          Node actions
        </div>

        {/* Edit works for all node types; for hazards it's just the label */}
        <button
          style={{
            width: "100%",
            padding: "4px 6px",
            fontSize: "0.8rem",
            background: "#3b82f6",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
            marginBottom: "6px",
          }}
          onClick={() => this.handleNodeMenuAction("editNode")}
        >
          Edit…
        </button>

        {!nodeMenu.isHazard && (
          <>
            {nodeMenu.canCollapse ? (
              <button
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  fontSize: "0.8rem",
                  background: "#2563eb",
                  border: "none",
                  borderRadius: "4px",
                  color: "white",
                  cursor: "pointer",
                  marginBottom: "6px",
                }}
                onClick={() => this.handleNodeMenuAction("toggleCollapse")}
              >
                {nodeMenu.isCollapsed ? "Expand branch" : "Collapse branch"}
              </button>
            ) : (
              <div
                style={{
                  fontSize: "0.8rem",
                  opacity: 0.7,
                  marginBottom: "6px",
                }}
              >
                No collapsible path from this node to Top Event.
              </div>
            )}

            {nodeMenu.isConsequence && (
              <button
                style={{
                  width: "100%",
                  padding: "4px 6px",
                  fontSize: "0.8rem",
                  background: "#0ea5e9",
                  border: "none",
                  borderRadius: "4px",
                  color: "white",
                  cursor: "pointer",
                  marginBottom: "6px",
                }}
                onClick={() =>
                  this.handleNodeMenuAction("toggleConsequenceCollapse")
                }
              >
                {nodeMenu.consequenceCollapsed
                  ? "Expand consequence branch"
                  : "Collapse consequence branch"}
              </button>
            )}

            {nodeMenu.isBarrier && (
              <>
                <button
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    fontSize: "0.8rem",
                    background: nodeMenu.barrierFailed
                      ? "#16a34a"
                      : "#b91c1c",
                    border: "none",
                    borderRadius: "4px",
                    color: "white",
                    cursor: "pointer",
                    marginBottom: "6px",
                  }}
                  onClick={() =>
                    this.handleNodeMenuAction("toggleBarrierFailed")
                  }
                >
                  {nodeMenu.barrierFailed
                    ? "Mark barrier as active"
                    : "Mark barrier as failed"}
                </button>

                <button
                  style={{
                    width: "100%",
                    padding: "4px 6px",
                    fontSize: "0.8rem",
                    background: "#4b5563",
                    border: "none",
                    borderRadius: "4px",
                    color: "white",
                    cursor: "pointer",
                    marginBottom: "6px",
                  }}
                  onClick={() =>
                    this.handleNodeMenuAction("toggleBarrierMeta")
                  }
                >
                  {nodeMenu.barrierShowMeta
                    ? "Hide barrier metadata"
                    : "Show barrier metadata"}
                </button>
              </>
            )}

            <button
              style={{
                width: "100%",
                padding: "4px 6px",
                fontSize: "0.8rem",
                background: "#f97316",
                border: "none",
                borderRadius: "4px",
                color: "white",
                cursor: "pointer",
                marginBottom: "6px",
              }}
              onClick={() => this.handleNodeMenuAction("highlightBranch")}
            >
              Highlight / Unhighlight branch
            </button>

            <button
              style={{
                width: "100%",
                padding: "4px 6px",
                fontSize: "0.8rem",
                background: "#b91c1c",
                border: "none",
                borderRadius: "4px",
                color: "white",
                cursor: "pointer",
                marginBottom: "4px",
              }}
              onClick={() => this.handleNodeMenuAction("deleteNode")}
            >
              Delete node
            </button>
          </>
        )}

        <button
          style={{
            width: "100%",
            padding: "3px 6px",
            fontSize: "0.78rem",
            background: "#374151",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
            marginTop: "2px",
          }}
          onClick={this.handleNodeMenuClose}
        >
          Close
        </button>
      </div>
    );
  }


  // ---------- Edge context menu (delete connection / insert node / highlight) ----------

  onEdgeContextMenu(event, edge) {
    event.preventDefault();
    event.stopPropagation();

    const wrapper = document.getElementById("root");
    const bounds = wrapper
      ? wrapper.getBoundingClientRect()
      : { left: 0, top: 0 };
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;

    const isSynthetic = !!(edge.data && edge.data.syntheticCollapse);

    // Compute midpoint between source/target nodes (in flow coordinates)
    const { nodes } = this.state;
    const srcNode = nodes.find((n) => n.id === edge.source);
    const tgtNode = nodes.find((n) => n.id === edge.target);
    let insertPosition = null;

    if (srcNode && tgtNode) {
      insertPosition = {
        x: (srcNode.position.x + tgtNode.position.x) / 2,
        y: (srcNode.position.y + tgtNode.position.y) / 2,
      };
    }

    this.setState((state) => ({
      ...state,
      edgeMenu: {
        ...state.edgeMenu,
        visible: true,
        x: localX,
        y: localY,
        edgeId: edge.id,
        canDelete: !isSynthetic,
        isSynthetic,
        canInsert: !!insertPosition && !isSynthetic,
        insertPosition,
        sourceId: edge.source,
        targetId: edge.target,
      },
      nodeMenu: { ...state.nodeMenu, visible: false },
      contextMenu: { ...state.contextMenu, visible: false },
    }));
  }

  handleEdgeMenuClose() {
    this.setState((state) => ({
      ...state,
      edgeMenu: { ...state.edgeMenu, visible: false },
    }));
  }

  handleEdgeDelete() {
    this.setState(
      (state) => {
        const { edgeId, canDelete } = state.edgeMenu;
        if (!edgeId || !canDelete) return state;

        const nextRawEdges = state.rawEdges.filter((e) => e.id !== edgeId);
        const processed = this.recalcNodes(
          state.nodes,
          nextRawEdges,
          undefined,
          undefined
        );

        return {
          ...state,
          rawEdges: nextRawEdges,
          nodes: processed.nodes,
          edges: processed.edges,
          edgeMenu: { ...state.edgeMenu, visible: false },
        };
      },
      this.pushToStreamlit
    );
  }

  handleEdgeInsertNode() {
    this.setState((state) => {
      const {
        canInsert,
        insertPosition,
        edgeId,
        sourceId,
        targetId,
        x,
        y,
      } = state.edgeMenu;

      if (!canInsert || !insertPosition || !edgeId || !sourceId || !targetId) {
        return state;
      }

      // Open the same "add barrier" context menu, but in "insert into this edge" mode
      return {
        ...state,
        pendingInsertFromEdge: { edgeId, sourceId, targetId },
        edgeMenu: { ...state.edgeMenu, visible: false },
        contextMenu: {
          ...state.contextMenu,
          visible: true,
          x,
          y,
          position: insertPosition,
          kind: "barrier",
          label: "",
          barrierType: "preventive",
        },
      };
    });
  }

  toggleBranchHighlight(startId) {
    this.setState(
      (state) => {
        const { nodes, rawEdges } = state;
        const { nodeIds, edgeIds } = collectBranch(startId, nodes, rawEdges);

        let anyHighlighted = false;
        nodes.forEach((n) => {
          if (nodeIds.has(n.id) && n.data && n.data.meta?.highlighted) {
            anyHighlighted = true;
          }
        });

        const newFlag = !anyHighlighted;

        const updatedNodes = nodes.map((n) => {
          if (!nodeIds.has(n.id)) return n;
          const meta = { ...((n.data && n.data.meta) || {}) };
          meta.highlighted = newFlag;
          return {
            ...n,
            data: {
              ...(n.data || {}),
              meta,
            },
          };
        });

        const updatedRawEdges = rawEdges.map((e) => {
          if (!edgeIds.has(e.id)) return e;
          const data = { ...(e.data || {}) };
          data.highlighted = newFlag;
          return { ...e, data };
        });

        const processed = this.recalcNodes(
          updatedNodes,
          updatedRawEdges,
          undefined,
          undefined
        );

        return {
          ...state,
          nodes: processed.nodes,
          edges: processed.edges,
          rawEdges: updatedRawEdges,
        };
      },
      this.pushToStreamlit
    );
  }

  renderEdgeMenu() {
    const { edgeMenu } = this.state;
    if (!edgeMenu.visible) return null;

    const menuStyle = {
      position: "absolute",
      left: edgeMenu.x,
      top: edgeMenu.y,
      background: "#111827",
      color: "white",
      padding: "8px 10px",
      borderRadius: "8px",
      boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
      zIndex: 16,
      minWidth: "220px",
      fontSize: "0.85rem",
      border: "1px solid rgba(255,255,255,0.08)",
    };

    return (
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>
          Connection actions
        </div>

        <button
          style={{
            width: "100%",
            padding: "4px 6px",
            fontSize: "0.8rem",
            background: "#f97316",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
            marginBottom: "6px",
          }}
          onClick={() =>
            this.toggleBranchHighlight(this.state.edgeMenu.sourceId)
          }
        >
          Highlight / Unhighlight branch
        </button>

        {edgeMenu.canInsert && (
          <button
            style={{
              width: "100%",
              padding: "4px 6px",
              fontSize: "0.8rem",
              background: "#10b981",
              border: "none",
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
              marginBottom: "6px",
            }}
            onClick={this.handleEdgeInsertNode}
          >
            Insert barrier node here
          </button>
        )}

        {edgeMenu.canDelete ? (
          <button
            style={{
              width: "100%",
              padding: "4px 6px",
              fontSize: "0.8rem",
              background: "#b91c1c",
              border: "none",
              borderRadius: "4px",
              color: "white",
              cursor: "pointer",
              marginBottom: "4px",
            }}
            onClick={this.handleEdgeDelete}
          >
            Delete connection
          </button>
        ) : (
          <div
            style={{ fontSize: "0.8rem", opacity: 0.7, marginBottom: "4px" }}
          >
            This is a collapse shortcut. Expand the threat node to remove it.
          </div>
        )}

        <button
          style={{
            width: "100%",
            padding: "3px 6px",
            fontSize: "0.78rem",
            background: "#374151",
            border: "none",
            borderRadius: "4px",
            color: "white",
            cursor: "pointer",
            marginTop: "2px",
          }}
          onClick={this.handleEdgeMenuClose}
        >
          Close
        </button>
      </div>
    );
  }

  // ---------- Render ----------

  render() {
    const { nodes, edges } = this.state;
    const height = this.props.args.height || 700;

    const nodeTypes = {
      topEvent: TopEventNode,
      hazard: HazardNode,
    };

    return (
      <div
        style={{
          width: "100%",
          height: `${height}px`,
          position: "relative",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={this.onNodesChange}
          onEdgesChange={this.onEdgesChange}
          onConnect={this.onConnect}
          onInit={this.onInit}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          panOnScroll
          zoomOnScroll
          zoomOnPinch
          onPaneContextMenu={this.onPaneContextMenu}
          onPaneClick={this.onPaneClick}
          onNodeDoubleClick={this.onNodeDoubleClick}
          onNodeContextMenu={this.onNodeContextMenu}
          onEdgeContextMenu={this.onEdgeContextMenu}
        >
          <Background />

          <MiniMap
            pannable
            zoomable
            style={{
              background: "#020617",
              borderRadius: 8,
              boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
            }}
          />

          <Controls
            position="top-right"
            showZoom={true}
            showFitView={true}
            showInteractive={false}
            style={{
              backgroundColor: "#020617",
              borderRadius: 8,
              boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
              border: "1px solid rgba(148,163,184,0.5)",
            }}
          />
        </ReactFlow>

        {this.renderContextMenu()}
        {this.renderEditPanel()}
        {this.renderNodeMenu()}
        {this.renderEdgeMenu()}
      </div>
    );
  }
}

const Wrapped = withStreamlitConnection(BowtieFlowComponent);

const rootEl = document.getElementById("root");
const root = ReactDOM.createRoot(rootEl);
root.render(<Wrapped />);
