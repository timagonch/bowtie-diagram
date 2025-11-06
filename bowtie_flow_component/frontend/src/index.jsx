import React from "react";
import ReactDOM from "react-dom/client";

import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  Streamlit,
  StreamlitComponentBase,
  withStreamlitConnection,
} from "streamlit-component-lib";

/**
 * ---------- Risk helpers ----------
 */

function riskColor(risk) {
  if (risk >= 20) return "#fecaca"; // red-ish
  if (risk >= 12) return "#fde68a"; // amber
  return "#dcfce7"; // green
}

function combinedEff(effsPct) {
  if (!effsPct || effsPct.length === 0) return 0.0;
  const effs = effsPct.map((x) => {
    let v = parseInt(x, 10);
    if (Number.isNaN(v)) v = 0;
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    return v / 100.0;
  });
  let p = 1.0;
  effs.forEach((e) => {
    p *= 1 - e;
  });
  return 1 - p;
}

function ensureMeta(node) {
  if (!node.data) node.data = {};
  if (!node.data.meta) node.data.meta = {};
  const meta = node.data.meta;

  if (meta.severity == null) meta.severity = 3;
  if (meta.likelihood == null) meta.likelihood = 3;

  if (meta.kind === "barrier") {
    if (meta.barrierType == null) meta.barrierType = "preventive";
    if (meta.effectiveness == null) meta.effectiveness = 0;
  }

  const base = Number(meta.severity) * Number(meta.likelihood);
  meta.base_risk = base;
  if (meta.current_risk == null) meta.current_risk = base;
  if (meta.residual_risk == null) meta.residual_risk = base;

  if (!node.data.baseLabel) {
    node.data.baseLabel = node.data.label || "";
  }
}

/**
 * Core risk engine – only counts threats that actually connect to Top Event
 */
function computeAggregatedRisk(nodesIn, edgesIn) {
  const nodes = (nodesIn || []).map((n) => ({
    ...n,
    data: {
      ...(n.data || {}),
      meta: { ...((n.data || {}).meta || {}) },
    },
    style: { ...(n.style || {}) },
  }));
  const edges = (edgesIn || []).map((e) => ({ ...e }));

  const nodesById = {};
  nodes.forEach((n) => {
    nodesById[n.id] = n;
  });

  const outEdges = {};
  const inEdges = {};
  nodes.forEach((n) => {
    outEdges[n.id] = [];
    inEdges[n.id] = [];
  });
  edges.forEach((e) => {
    if (outEdges[e.source]) outEdges[e.source].push(e);
    if (inEdges[e.target]) inEdges[e.target].push(e);
  });

  nodes.forEach((n) => ensureMeta(n));

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
    if (n.id.startsWith("center_")) {
      n.targetPosition = "left";
      n.sourcePosition = "right";
    }
  });

  const centerCandidates = nodes.filter(
    (n) => typeof n.id === "string" && n.id.startsWith("center_")
  );

  const centerId =
    centerCandidates.length > 0
      ? centerCandidates[centerCandidates.length - 1].id
      : null;

  // ---------- 1) Threat residuals (preventive barriers act here only) ----------
  const threatResiduals = {};
  nodes.forEach((n) => {
    if (typeof n.id !== "string" || !n.id.startsWith("threat_")) return;

    const meta = n.data.meta;
    const base = Number(meta.severity) * Number(meta.likelihood);

    const ownedBarriers = new Set();
    (outEdges[n.id] || []).forEach((e) => {
      const tgt = nodesById[e.target];
      if (tgt && typeof tgt.id === "string" && tgt.id.startsWith("barrier_")) {
        ownedBarriers.add(tgt.id);
      }
    });

    const effs = [];
    ownedBarriers.forEach((bid) => {
      const bnode = nodesById[bid];
      if (!bnode) return;
      const bmeta = (bnode.data && bnode.data.meta) || {};
      if ((bmeta.barrierType || "preventive") !== "preventive") return;
      effs.push(bmeta.effectiveness || 0);
    });

    const combinedPrev = combinedEff(effs);
    const residual = base * (1 - combinedPrev);

    meta.base_risk = base;
    meta.current_risk = residual;
    meta.residual_risk = residual;

    n.style = { ...(n.style || {}), background: riskColor(residual) };
    const baseLabel = n.data.baseLabel || n.data.label || "";
    n.data.label = `${baseLabel} | Base ${base} → Residual ${Math.round(
      residual
    )}`;

    threatResiduals[n.id] = residual;
  });

  // ---------- 1b) Only sum threats connected (via any path) to Top Event ----------
  const connectedThreats = new Set();
  if (centerId && nodesById[centerId]) {
    const visited = new Set();
    const stack = [centerId];

    while (stack.length > 0) {
      const nid = stack.pop();
      if (visited.has(nid)) continue;
      visited.add(nid);

      (inEdges[nid] || []).forEach((e) => {
        const sid = e.source;
        if (!visited.has(sid)) {
          stack.push(sid);
        }
      });
    }

    visited.forEach((nid) => {
      if (typeof nid === "string" && nid.startsWith("threat_")) {
        connectedThreats.add(nid);
      }
    });
  } else {
    Object.keys(threatResiduals).forEach((tid) => connectedThreats.add(tid));
  }

  const sumThreats = Array.from(connectedThreats).reduce(
    (acc, tid) => acc + Number(threatResiduals[tid] || 0),
    0
  );

  // ---------- 2) Top Event (center) ----------
  let centerResidual = 0.0;
  if (centerId && nodesById[centerId]) {
    const cnode = nodesById[centerId];
    const cmeta = cnode.data.meta;

    const cCurrent = sumThreats;
    const cResidual = cCurrent;

    cmeta.current_risk = cCurrent;
    cmeta.residual_risk = cResidual;

    cnode.style = { ...(cnode.style || {}), background: riskColor(cResidual) };
    const baseLabel = cnode.data.baseLabel || cnode.data.label || "";
    cnode.data.label = `${baseLabel} | Current Σ threats ${Math.round(
      cCurrent
    )}`;

    centerResidual = cResidual;
  } else {
    centerResidual = 0.0;
  }

  // ---------- 3) Consequences (mitigative barriers act here) ----------
  nodes.forEach((n) => {
    if (typeof n.id !== "string" || !n.id.startsWith("conseq_")) return;

    const meta = n.data.meta;
    const base = Number(meta.severity) * Number(meta.likelihood);

    const cCurrent = centerResidual * base;

    const effsMit = [];
    (inEdges[n.id] || []).forEach((e) => {
      const src = nodesById[e.source];
      if (!src || typeof src.id !== "string" || !src.id.startsWith("barrier_"))
        return;
      const bmeta = (src.data && src.data.meta) || {};
      if ((bmeta.barrierType || "mitigative") !== "mitigative") return;
      effsMit.push(bmeta.effectiveness || 0);
    });

    const combinedMit = combinedEff(effsMit);
    const residual = cCurrent * (1 - combinedMit);

    meta.base_risk = base;
    meta.current_risk = cCurrent;
    meta.residual_risk = residual;

    n.style = { ...(n.style || {}), background: riskColor(residual) };
    const baseLabel = n.data.baseLabel || n.data.label || "";
    n.data.label = `${baseLabel} | Base ${base} | Curr from Top ${Math.round(
      cCurrent
    )} → Residual ${Math.round(residual)}`;
  });

  // ---------- 4) Tint barriers by effectiveness ----------
  nodes.forEach((n) => {
    if (typeof n.id !== "string" || !n.id.startsWith("barrier_")) return;

    const bmeta = n.data.meta;
    let beff = parseInt(bmeta.effectiveness || 0, 10);
    if (Number.isNaN(beff)) beff = 0;
    if (beff < 0) beff = 0;
    if (beff > 100) beff = 100;

    let bg = "#fee2e2";
    if (beff >= 75) bg = "#dcfce7";
    else if (beff >= 40) bg = "#fde68a";

    n.style = { ...(n.style || {}), background: bg };
    const baseLabel = n.data.baseLabel || n.data.label || "";
    const bt = bmeta.barrierType || "preventive";
    n.data.label = `${baseLabel} | ${bt} ${beff}%`;
  });

  return nodes;
}

/**
 * Collapse engine: hide all downstream barriers and add synthetic Threat → Top Event edges
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
        viewEdges.push({
          id: `collapse_${threatId}_${centerId}`,
          source: threatId,
          target: centerId,
          type: "default",
          data: { syntheticCollapse: true },
        });
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

/**
 * ---------- Main component ----------
 */

class BowtieFlowComponent extends StreamlitComponentBase {
  constructor(props) {
    super(props);

    this.state = {
      nodes: [],
      edges: [], // view edges for ReactFlow
      rawEdges: [], // canonical edges
      rfInstance: null,
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        position: { x: 0, y: 0 },
        kind: "threat",
        label: "",
        barrierType: "preventive",
        effectiveness: 50,
        severity: 3,
        likelihood: 3,
      },
      editPanel: {
        visible: false,
        nodeId: null,
        kind: "",
        label: "",
        severity: 3,
        likelihood: 3,
        barrierType: "preventive",
        effectiveness: 50,
      },
      collapsedThreats: [],
      nodeMenu: {
        visible: false,
        x: 0,
        y: 0,
        nodeId: null,
        canCollapse: false,
        isCollapsed: false,
      },
      edgeMenu: {
        visible: false,
        x: 0,
        y: 0,
        edgeId: null,
        canDelete: true,
        isSynthetic: false,
      },
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
  }

  componentDidMount() {
    this.syncFromProps();
  }

  recalcNodes(rawNodes, rawEdges, collapsedOverride) {
    const collapsedThreats =
      collapsedOverride !== undefined && collapsedOverride !== null
        ? collapsedOverride
        : this.state.collapsedThreats;

    const riskNodes = computeAggregatedRisk(rawNodes, rawEdges);

    if (!collapsedThreats || collapsedThreats.length === 0) {
      riskNodes.forEach((n) => {
        n.hidden = false;
      });
      return { nodes: riskNodes, edges: rawEdges };
    }

    return applyCollapse(riskNodes, rawEdges, collapsedThreats);
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
        effectiveness: 50,
        severity: 3,
        likelihood: 3,
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
    }));
  }

  handleAddNodeFromMenu() {
    const {
      position,
      kind,
      label,
      barrierType,
      effectiveness,
      severity,
      likelihood,
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
        severity: Number(severity) || 3,
        likelihood: Number(likelihood) || 3,
      };
    } else if (kind === "consequence") {
      idPrefix = "conseq";
      baseLabel = `❗ Consequence: ${displayLabel}`;
      meta = {
        kind: "consequence",
        severity: Number(severity) || 3,
        likelihood: Number(likelihood) || 3,
      };
    } else if (kind === "barrier") {
      idPrefix = "barrier";
      baseLabel = `🛡 Barrier: ${displayLabel}`;
      meta = {
        kind: "barrier",
        barrierType,
        effectiveness: Number(effectiveness) || 0,
      };
    } else if (kind === "center") {
      idPrefix = "center";
      baseLabel = `🎯 ${displayLabel}`;
      meta = {
        kind: "center",
      };
    }

    const newNode = {
      id: `${idPrefix}_${Date.now()}`,
      position,
      data: {
        label: baseLabel,
        baseLabel: baseLabel,
        meta: meta,
      },
      type: "default",
    };

    this.setState(
      (state) => {
        const updatedNodes = [...state.nodes, newNode];
        const processed = this.recalcNodes(updatedNodes, state.rawEdges);
        return {
          ...state,
          nodes: processed.nodes,
          edges: processed.edges,
          contextMenu: { ...state.contextMenu, visible: false },
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
      minWidth: "230px",
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
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>
          Add node at click
        </div>

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

        {(contextMenu.kind === "threat" ||
          contextMenu.kind === "consequence") && (
          <>
            <label style={{ display: "block", marginTop: "4px" }}>
              Severity (1–5)
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="5"
                value={contextMenu.severity}
                onChange={(e) =>
                  this.handleMenuFieldChange("severity", e.target.value)
                }
              />
            </label>

            <label style={{ display: "block", marginTop: "4px" }}>
              Likelihood (1–5)
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="5"
                value={contextMenu.likelihood}
                onChange={(e) =>
                  this.handleMenuFieldChange("likelihood", e.target.value)
                }
              />
            </label>
          </>
        )}

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
              Effectiveness (%)
              <input
                style={inputStyle}
                type="number"
                min="0"
                max="100"
                value={contextMenu.effectiveness}
                onChange={(e) =>
                  this.handleMenuFieldChange(
                    "effectiveness",
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
    event.preventDefault();
    event.stopPropagation();

    const meta = (node.data && node.data.meta) || {};
    let kind = meta.kind;
    if (!kind && typeof node.id === "string") {
      if (node.id.startsWith("threat_")) kind = "threat";
      else if (node.id.startsWith("conseq_")) kind = "consequence";
      else if (node.id.startsWith("barrier_")) kind = "barrier";
      else if (node.id.startsWith("center_")) kind = "center";
    }

    const baseLabel = node.data.baseLabel || node.data.label || "";
    const cleaned = baseLabel
      .replace(/^⚠ Threat:\s*/i, "")
      .replace(/^❗ Consequence:\s*/i, "")
      .replace(/^🛡 Barrier:\s*/i, "")
      .replace(/^🎯\s*/, "");

    const severity = meta.severity != null ? meta.severity : 3;
    const likelihood = meta.likelihood != null ? meta.likelihood : 3;
    const barrierType = meta.barrierType || "preventive";
    const effectiveness =
      meta.effectiveness != null ? meta.effectiveness : 50;

    this.setState((state) => ({
      ...state,
      editPanel: {
        visible: true,
        nodeId: node.id,
        kind: kind || "node",
        label: cleaned,
        severity,
        likelihood,
        barrierType,
        effectiveness,
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
          severity,
          likelihood,
          barrierType,
          effectiveness,
        } = state.editPanel;

        const cleanedLabel = label.trim() || "Node";

        const updatedNodes = state.nodes.map((n) => {
          if (n.id !== nodeId) return n;

          const meta = { ...((n.data && n.data.meta) || {}) };
          let baseLabel = cleanedLabel;

          if (kind === "threat") {
            baseLabel = `⚠ Threat: ${cleanedLabel}`;
            meta.kind = "threat";
            meta.severity = Number(severity) || 3;
            meta.likelihood = Number(likelihood) || 3;
          } else if (kind === "consequence") {
            baseLabel = `❗ Consequence: ${cleanedLabel}`;
            meta.kind = "consequence";
            meta.severity = Number(severity) || 3;
            meta.likelihood = Number(likelihood) || 3;
          } else if (kind === "barrier") {
            baseLabel = `🛡 Barrier: ${cleanedLabel}`;
            meta.kind = "barrier";
            meta.barrierType = barrierType;
            meta.effectiveness = Number(effectiveness) || 0;
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

          return { ...n, data: newData };
        });

        const processed = this.recalcNodes(updatedNodes, state.rawEdges);

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

        <label style={{ display: "block", marginTop: "4px" }}>
          Type
          <select
            style={inputStyle}
            value={editPanel.kind}
            onChange={(e) =>
              this.handleEditFieldChange("kind", e.target.value)
            }
          >
            <option value="threat">Threat</option>
            <option value="barrier">Barrier</option>
            <option value="consequence">Consequence</option>
            <option value="center">Top Event</option>
          </select>
        </label>

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

        {(editPanel.kind === "threat" ||
          editPanel.kind === "consequence") && (
          <>
            <label style={{ display: "block", marginTop: "4px" }}>
              Severity (1–5)
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="5"
                value={editPanel.severity}
                onChange={(e) =>
                  this.handleEditFieldChange("severity", e.target.value)
                }
              />
            </label>

            <label style={{ display: "block", marginTop: "4px" }}>
              Likelihood (1–5)
              <input
                style={inputStyle}
                type="number"
                min="1"
                max="5"
                value={editPanel.likelihood}
                onChange={(e) =>
                  this.handleEditFieldChange("likelihood", e.target.value)
                }
              />
            </label>
          </>
        )}

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
              Effectiveness (%)
              <input
                style={inputStyle}
                type="number"
                min="0"
                max="100"
                value={editPanel.effectiveness}
                onChange={(e) =>
                  this.handleEditFieldChange(
                    "effectiveness",
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

  // ---------- Node context menu (collapse / delete) ----------

  onNodeContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();

    const { rawEdges, collapsedThreats, nodes } = this.state;

    const wrapper = document.getElementById("root");
    const bounds = wrapper
      ? wrapper.getBoundingClientRect()
      : { left: 0, top: 0 };
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;

    const isThreat =
      typeof node.id === "string" && node.id.startsWith("threat_");

    const centerCandidates = nodes.filter(
      (n) => typeof n.id === "string" && n.id.startsWith("center_")
    );
    const centerId =
      centerCandidates.length > 0
        ? centerCandidates[centerCandidates.length - 1].id
        : null;

    let canCollapse = false;

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

      canCollapse = hasBarrier && reachesCenter;
    }

    const isCollapsed = collapsedThreats.includes(node.id);

    this.setState((state) => ({
      ...state,
      nodeMenu: {
        ...state.nodeMenu,
        visible: true,
        x: localX,
        y: localY,
        nodeId: node.id,
        canCollapse,
        isCollapsed,
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
    if (action === "toggleCollapse") {
      this.setState(
        (state) => {
          const nodeId = state.nodeMenu.nodeId;
          if (!nodeId) return state;

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
            state.nodes,
            state.rawEdges,
            nextCollapsed
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            collapsedThreats: nextCollapsed,
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
          const nextCollapsed = (state.collapsedThreats || []).filter(
            (id) => id !== nodeId
          );

          const processed = this.recalcNodes(
            nextNodes,
            nextRawEdges,
            nextCollapsed
          );

          return {
            ...state,
            nodes: processed.nodes,
            edges: processed.edges,
            rawEdges: nextRawEdges,
            collapsedThreats: nextCollapsed,
            nodeMenu: { ...state.nodeMenu, visible: false },
          };
        },
        this.pushToStreamlit
      );
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
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>Node actions</div>

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

  // ---------- Edge context menu (delete connection) ----------

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
        const processed = this.recalcNodes(state.nodes, nextRawEdges);

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
      minWidth: "200px",
      fontSize: "0.85rem",
      border: "1px solid rgba(255,255,255,0.08)",
    };

    return (
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>
          Connection actions
        </div>

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
          <div style={{ fontSize: "0.8rem", opacity: 0.7, marginBottom: "4px" }}>
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
