import json
import base64
import html
from uuid import uuid4
from math import prod
import streamlit as st

# React Flow wrapper
from streamlit_flow import streamlit_flow
from streamlit_flow.elements import StreamlitFlowNode, StreamlitFlowEdge
from streamlit_flow.state import StreamlitFlowState

# ======================== Page setup ========================
st.set_page_config(page_title="Bow-Tie Builder (Aggregated Risk Model)", layout="wide")
st.title("Bow-Tie Risk (Threats → Top Event → Consequences) — Aggregated Model")

# Slimmer sidebars text
st.markdown(
    """
    <style>
      div[data-testid="column"]:nth-of-type(1) * { font-size: 0.92rem; }
      div[data-testid="column"]:nth-of-type(3) * { font-size: 0.92rem; }
      div[data-testid="stExpander"] > details > summary { font-size: 0.95rem; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ======================== Session state bootstrap (must be before node creation) ========================
if "icons" not in st.session_state:
    st.session_state.icons = {"threat": None, "consequence": None, "barrier": None}
if "layout_counters" not in st.session_state:
    st.session_state.layout_counters = {"threat": 0, "consequence": 0, "barrier": 0}
if "details" not in st.session_state:
    st.session_state.details = {}          # node_id -> [bullets]
if "expanded_ids" not in st.session_state:
    st.session_state.expanded_ids = set()  # node_ids expanded on canvas

# ======================== Utilities ========================
def uid(prefix: str = "n") -> str:
    return f"{prefix}_{uuid4().hex[:8]}"

def to_data_uri(file_bytes: bytes, filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "png"
    mime = "image/svg+xml" if ext == "svg" else "image/png"
    b64 = base64.b64encode(file_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"

def icon_tag(data_uri: str, size: int = 18) -> str:
    return (
        f'<img src="{data_uri}" width="{size}" height="{size}" '
        f'style="vertical-align:-3px;margin-right:6px;border-radius:2px;">'
    )

def icon_markup(kind: str) -> str:
    custom = st.session_state.get("icons", {}).get(kind)
    if custom:
        return icon_tag(custom, size=18)
    return {"threat": "⚠️", "consequence": "❗", "barrier": "🛡️", "center": "🎯"}.get(kind, "")

def get_pos(node) -> tuple[float, float]:
    pos = getattr(node, "position", None)
    if isinstance(pos, dict):
        return float(pos.get("x", 0.0)), float(pos.get("y", 0.0))
    if isinstance(pos, (list, tuple)) and len(pos) >= 2:
        return float(pos[0]), float(pos[1])
    pos = getattr(node, "pos", None)
    if isinstance(pos, (list, tuple)) and len(pos) >= 2:
        return float(pos[0]), float(pos[1])
    return 0.0, 0.0

def set_pos(node, x: float, y: float) -> None:
    try:
        node.position = {"x": float(x), "y": float(y)}
    except Exception:
        pass
    try:
        node.pos = (float(x), float(y))
    except Exception:
        pass

def get_selected_node_ids(flow_state):
    """Best-effort: pull selected node ids from various shapes across versions."""
    cand = []
    for attr in ("selected_nodes", "selectedNodeIds", "selection", "selected", "ui"):
        if hasattr(flow_state, attr):
            val = getattr(flow_state, attr)
            if isinstance(val, (list, tuple)):
                cand = val
                break
            if isinstance(val, dict):
                if "nodes" in val and isinstance(val["nodes"], list):
                    cand = [n.get("id") for n in val["nodes"] if isinstance(n, dict) and "id" in n]
                    break
                if "selectedNodeIds" in val and isinstance(val["selectedNodeIds"], list):
                    cand = val["selectedNodeIds"]
                    break
    return [str(x) for x in cand if x is not None]

def render_node_content(node_id: str, base_html: str) -> str:
    """Base text + optional bullet list if node_id is expanded."""
    bullets = st.session_state.get("details", {}).get(node_id, [])
    expanded = st.session_state.get("expanded_ids", set())
    if node_id not in expanded or not bullets:
        return base_html
    items = "".join(f"<li>{html.escape(b).replace('\\n','<br>')}</li>" for b in bullets)
    return (
        f"{base_html}"
        f"<div style='margin-top:6px;font-size:0.9rem;'>"
        f"<strong>Details</strong>"
        f"<ul style='margin:4px 0 0 18px;'>{items}</ul>"
        f"</div>"
    )

# ======================== Risk helpers ========================
def risk_color(risk: float) -> str:
    # Simple bands; tweak to taste
    if risk >= 20: return "#fecaca"   # red-ish
    if risk >= 12: return "#fde68a"   # amber
    return "#dcfce7"                  # green

def ensure_meta(node):
    """Only barriers have 'effectiveness'. All nodes have severity/likelihood."""
    node.data.setdefault("meta", {})
    meta = node.data["meta"]
    meta.setdefault("severity", 3)
    meta.setdefault("likelihood", 3)

    if node.id.startswith("barrier_"):
        meta.setdefault("effectiveness", 0)            # % 0–100, only for barriers
        meta.setdefault("barrier_type", "preventive")  # preventive | mitigative

    # Initialize fields used in badges
    meta.setdefault("base_risk", meta["severity"] * meta["likelihood"])
    meta.setdefault("current_risk", meta["base_risk"])
    meta.setdefault("residual_risk", meta["base_risk"])

def _combined_eff(effs_pct):
    """Combine independent barrier effectiveness values given as 0..100 ints."""
    if not effs_pct:
        return 0.0
    effs = [max(0, min(100, int(x))) / 100.0 for x in effs_pct]
    return 1 - prod([(1 - e) for e in effs])

def compute_residuals_aggregated(state: StreamlitFlowState):
    """
    Aggregated model (sum):
    1) For each THREAT:
         base = S×L
         preventive barriers 'owned' by that threat reduce it -> threat_residual
    2) TOP EVENT (center):
         base = S×L (inherent)
         current = sum(threat_residual for all threats)           <-- aggregation
         residual = current × (1 - combined_preventive_at_center) <-- optional extra prevention at center
    3) For each CONSEQUENCE:
         base = S×L (local display)
         current = top_event_residual × (S_conseq × L_conseq)     <-- uses consequence S&L as weight
         residual = current × (1 - combined_mitigative_at_conseq)
    Notes on 'owned' barriers for a threat:
      - A preventive barrier counts for a threat if it is connected FROM that threat (threat -> barrier)
        OR if it is connected to the center (barrier -> center). The second rule approximates shared
        preventive controls near the center that intercept multiple threats.
    """

    # -- Build lookups
    nodes_by_id = {n.id: n for n in state.nodes}
    out_edges = {}
    in_edges = {}
    for n in state.nodes:
        out_edges[n.id] = []
        in_edges[n.id] = []
    for e in state.edges:
        if e.source in out_edges:
            out_edges[e.source].append(e)
        if e.target in in_edges:
            in_edges[e.target].append(e)

    # -- Ensure meta defaults
    for n in state.nodes:
        ensure_meta(n)

    # -- Identify center (last created if multiple)
    center_ids = [n.id for n in state.nodes if n.id.startswith("center_")]
    center_id = center_ids[-1] if center_ids else None

    # ---------- 1) Threat residuals ----------
    threat_residuals = {}
    for n in state.nodes:
        if not n.id.startswith("threat_"):
            continue
        meta = n.data["meta"]
        base = int(meta.get("severity", 3)) * int(meta.get("likelihood", 3))

        # Preventive barriers "owned" by this threat:
        #   a) edges: threat -> barrier
        #   b) or preventive barriers that go to center (shared controls)
        owned_barriers = set()
        for e in out_edges[n.id]:
            tgt = nodes_by_id.get(e.target)
            if tgt and tgt.id.startswith("barrier_"):
                owned_barriers.add(tgt.id)

        if center_id:
            for e in in_edges[center_id]:  # anything -> center
                src = nodes_by_id.get(e.source)
                if src and src.id.startswith("barrier_"):
                    owned_barriers.add(src.id)

        effs = []
        for bid in owned_barriers:
            bnode = nodes_by_id.get(bid)
            if not bnode:
                continue
            bmeta = bnode.data.get("meta", {})
            if bmeta.get("barrier_type", "preventive") != "preventive":
                continue
            effs.append(int(bmeta.get("effectiveness", 0)))

        combined_prev = _combined_eff(effs)
        residual = base * (1 - combined_prev)

        meta["base_risk"] = base
        meta["current_risk"] = residual  # for threats, "current" == "residual after their own prev barriers"
        meta["residual_risk"] = residual

        # Tint & badge
        n.style = {**(n.style or {}), "background": risk_color(residual)}
        base_content = n.data.get("base_content", n.data.get("content", ""))
        badge = (
            f"<div style='margin-top:6px;font-size:0.85rem;'>"
            f"Base: <b>{base}</b> → Residual: <b>{int(round(residual))}</b>"
            f"</div>"
        )
        n.data["content"] = render_node_content(n.id, base_content + badge)

        threat_residuals[n.id] = residual

    # Sum all threat residuals → Top Event current
    sum_threats = sum(threat_residuals.values()) if threat_residuals else 0

    # ---------- 2) Center (Top Event) ----------
    if center_id:
        cnode = nodes_by_id[center_id]
        cmeta = cnode.data["meta"]
        c_base = int(cmeta.get("severity", 3)) * int(cmeta.get("likelihood", 3))
        c_current = float(sum_threats)

        # Center-level preventive barriers (incoming to center)
        effs_center = []
        for e in in_edges[center_id]:
            src = nodes_by_id.get(e.source)
            if not src or not src.id.startswith("barrier_"):
                continue
            bmeta = src.data.get("meta", {})
            if bmeta.get("barrier_type", "preventive") != "preventive":
                continue
            effs_center.append(int(bmeta.get("effectiveness", 0)))
        combined_prev_center = _combined_eff(effs_center)
        c_residual = c_current * (1 - combined_prev_center)

        cmeta["base_risk"] = c_base
        cmeta["current_risk"] = c_current
        cmeta["residual_risk"] = c_residual

        cnode.style = {**(cnode.style or {}), "background": risk_color(c_residual)}
        base_content = cnode.data.get("base_content", cnode.data.get("content", ""))
        badge = (
            f"<div style='margin-top:6px;font-size:0.85rem;'>"
            f"Base: <b>{c_base}</b> | Current (Σ threats): <b>{int(round(c_current))}</b>"
            f" → Residual: <b>{int(round(c_residual))}</b>"
            f"</div>"
        )
        cnode.data["content"] = render_node_content(cnode.id, base_content + badge)
    else:
        c_residual = 0.0  # No center; downstream will be zeros

    # ---------- 3) Consequences ----------
    for n in state.nodes:
        if not n.id.startswith("conseq_"):
            continue
        meta = n.data["meta"]
        base = int(meta.get("severity", 3)) * int(meta.get("likelihood", 3))

        # Current consequence risk uses top-event residual as likelihood mass times local S×L as weight
        c_current = c_residual * base

        # Mitigative barriers incoming to consequence
        effs_mit = []
        for e in in_edges[n.id]:
            src = nodes_by_id.get(e.source)
            if not src or not src.id.startswith("barrier_"):
                continue
            bmeta = src.data.get("meta", {})
            if bmeta.get("barrier_type", "mitigative") != "mitigative":
                continue
            effs_mit.append(int(bmeta.get("effectiveness", 0)))
        combined_mit = _combined_eff(effs_mit)
        residual = c_current * (1 - combined_mit)

        meta["base_risk"] = base
        meta["current_risk"] = c_current
        meta["residual_risk"] = residual

        n.style = {**(n.style or {}), "background": risk_color(residual)}
        base_content = n.data.get("base_content", n.data.get("content", ""))
        badge = (
            f"<div style='margin-top:6px;font-size:0.85rem;'>"
            f"Base: <b>{base}</b> | Current(from Top): <b>{int(round(c_current))}</b>"
            f" → Residual: <b>{int(round(residual))}</b>"
            f"</div>"
        )
        n.data["content"] = render_node_content(n.id, base_content + badge)

    # ---------- 4) Tint barriers by their effectiveness ----------
    for n in state.nodes:
        if n.id.startswith("barrier_"):
            bmeta = n.data["meta"]
            beff = max(0, min(100, int(bmeta.get("effectiveness", 0))))
            if beff >= 75:
                bg = "#dcfce7"
            elif beff >= 40:
                bg = "#fde68a"
            else:
                bg = "#fee2e2"
            n.style = {**(n.style or {}), "background": bg}
            base_content = n.data.get("base_content", n.data.get("content", ""))
            n.data["content"] = render_node_content(n.id, base_content)

# ======================== Auto-layout helpers ========================
X_LEFT    = -350
X_RIGHT   =  350
X_BARRIER = -175
Y_STEP    = 120

def next_y(slot_key: str) -> int:
    idx = st.session_state.layout_counters.get(slot_key, 0)
    if idx == 0:
        off = 0
    else:
        k = (idx + 1) // 2
        off = k * (1 if idx % 2 == 1 else -1)
    st.session_state.layout_counters[slot_key] = idx + 1
    return int(off * Y_STEP)

# ======================== Node/Edge factories ========================
def make_center_node(title: str) -> StreamlitFlowNode:
    node = StreamlitFlowNode(
        id=uid("center"),
        node_type="default",
        data={"content": f"{icon_markup('center')} ### {title or 'Top Event'}"},
        style={"padding": 14, "borderRadius": 12, "border": "2px solid #555", "background": "#ffffff"},
        pos=(0, 0),
        source_position="right",
        target_position="left",
    )
    node.data["base_content"] = node.data.get("content", "")
    ensure_meta(node)
    node.data["content"] = render_node_content(node.id, node.data["base_content"])
    return node

def make_threat_node(label: str) -> StreamlitFlowNode:
    node = StreamlitFlowNode(
        id=uid("threat"),
        node_type="input",
        data={"content": f"{icon_markup('threat')} <strong>Threat:</strong> {label or 'New threat'}"},
        style={"padding": 10, "borderRadius": 10, "background": "#f6f8fa"},
        pos=(X_LEFT, next_y("threat")),
        source_position="right",
    )
    node.data["base_content"] = node.data.get("content", "")
    ensure_meta(node)
    node.data["content"] = render_node_content(node.id, node.data["base_content"])
    return node

def make_consequence_node(label: str) -> StreamlitFlowNode:
    node = StreamlitFlowNode(
        id=uid("conseq"),
        node_type="output",
        data={"content": f"{icon_markup('consequence')} <strong>Consequence:</strong> {label or 'New consequence'}"},
        style={"padding": 10, "borderRadius": 10, "background": "#fff7ed"},
        pos=(X_RIGHT, next_y("consequence")),
        target_position="left",
    )
    node.data["base_content"] = node.data.get("content", "")
    ensure_meta(node)
    node.data["content"] = render_node_content(node.id, node.data["base_content"])
    return node

def make_barrier_node(label: str, barrier_type: str = "preventive", effectiveness_pct: int = 0) -> StreamlitFlowNode:
    node = StreamlitFlowNode(
        id=uid("barrier"),
        node_type="default",
        data={"content": f"{icon_markup('barrier')} {label or '🛡️ Barrier'}"},
        style={"padding": 8, "borderRadius": 10, "background": "#e8f5e9", "border": "1px solid #84cc16"},
        pos=(X_BARRIER, next_y("barrier")),
    )
    node.data["base_content"] = node.data.get("content", "")
    ensure_meta(node)
    node.data["meta"]["barrier_type"] = barrier_type
    node.data["meta"]["effectiveness"] = int(effectiveness_pct)
    node.data["content"] = render_node_content(node.id, node.data["base_content"])
    return node

def make_edge(source: str, target: str) -> StreamlitFlowEdge:
    return StreamlitFlowEdge(id=uid("e"), source=source, target=target, marker_end="arrowclosed")

# ======================== Version-agnostic serializers ========================
def node_to_dict(n) -> dict:
    if hasattr(n, "to_dict") and callable(getattr(n, "to_dict")):
        return n.to_dict()
    if hasattr(n, "asdict") and callable(getattr(n, "asdict")):
        return n.asdict()
    x, y = get_pos(n)
    d = {
        "id": getattr(n, "id", uid("n")),
        "type": getattr(n, "node_type", getattr(n, "type", "default")),
        "data": getattr(n, "data", {}) or {},
        "style": getattr(n, "style", {}) or {},
        "position": {"x": x, "y": y},
    }
    sp = getattr(n, "source_position", None)
    tp = getattr(n, "target_position", None)
    if sp: d["sourcePosition"] = sp
    if tp: d["targetPosition"] = tp
    return d

def edge_to_dict(e) -> dict:
    if hasattr(e, "to_dict") and callable(getattr(e, "to_dict")):
        return e.to_dict()
    if hasattr(e, "asdict") and callable(getattr(e, "asdict")):
        return e.asdict()
    return {
        "id": getattr(e, "id", uid("e")),
        "source": getattr(e, "source"),
        "target": getattr(e, "target"),
        "markerEnd": getattr(e, "marker_end", getattr(e, "markerEnd", None)),
    }

def state_to_jsonable(state: StreamlitFlowState) -> dict:
    return {"nodes": [node_to_dict(n) for n in state.nodes],
            "edges": [edge_to_dict(e) for e in state.edges]}

def jsonable_to_state(blob: dict) -> StreamlitFlowState:
    nodes = []
    for d in blob.get("nodes", []):
        raw_pos = d.get("position", d.get("pos", (0, 0)))
        if isinstance(raw_pos, dict):
            pos_tup = (raw_pos.get("x", 0), raw_pos.get("y", 0))
        elif isinstance(raw_pos, (list, tuple)):
            pos_tup = tuple(raw_pos[:2])
        else:
            pos_tup = (0, 0)
        node = StreamlitFlowNode(
            id=d.get("id"),
            node_type=d.get("type", d.get("node_type", "default")),
            data=d.get("data", {}),
            style=d.get("style", {}),
            pos=pos_tup,
            source_position=d.get("sourcePosition", d.get("source_position")),
            target_position=d.get("targetPosition", d.get("target_position")),
        )
        if "base_content" not in node.data:
            node.data["base_content"] = node.data.get("content", "")
        ensure_meta(node)
        node.data["content"] = render_node_content(node.id, node.data["base_content"])
        nodes.append(node)

    edges = []
    for d in blob.get("edges", []):
        edges.append(
            StreamlitFlowEdge(
                id=d.get("id", uid("e")),
                source=d["source"],
                target=d["target"],
                marker_end=d.get("markerEnd", d.get("marker_end")),
            )
        )
    return StreamlitFlowState(nodes, edges)

# ======================== Flow state init (after bootstrap) ========================
if "flow_state" not in st.session_state:
    st.session_state.flow_state = StreamlitFlowState([make_center_node("Top Event")], [])

flow_state: StreamlitFlowState = st.session_state.flow_state

# Wider canvas column; smaller side columns
left, middle, right = st.columns([0.7, 3.6, 0.7])

# ======================== LEFT: add nodes ========================
with left:
    st.subheader("Add items")

    with st.expander("Top Event", expanded=False):
        top_title = st.text_input("Title", value="")
        if st.button("Set / Replace Top Event"):
            st.session_state.layout_counters = {"threat": 0, "consequence": 0, "barrier": 0}
            center_ids = {n.id for n in flow_state.nodes if n.id.startswith("center_")}
            flow_state.nodes = [n for n in flow_state.nodes if n.id not in center_ids]
            flow_state.edges = [e for e in flow_state.edges if e.source not in center_ids and e.target not in center_ids]
            flow_state.nodes.append(make_center_node(top_title))

    st.divider()
    with st.expander("Threat (left side)", expanded=True):
        t_label = st.text_input("Threat label", key="thr_lbl")
        t_link = st.checkbox("Auto-link to Top Event ➜", value=True)
        if st.button("Add Threat"):
            node = make_threat_node(t_label)
            flow_state.nodes.append(node)
            if t_link:
                centers = [n.id for n in flow_state.nodes if n.id.startswith("center_")]
                if centers:
                    flow_state.edges.append(make_edge(node.id, centers[-1]))

    st.divider()
    with st.expander("Consequence (right side)", expanded=True):
        c_label = st.text_input("Consequence label", key="con_lbl")
        c_link = st.checkbox("Top Event ➜ Consequence", value=True, key="cons_autolink")
        if st.button("Add Consequence"):
            node = make_consequence_node(c_label)
            flow_state.nodes.append(node)
            if c_link:
                centers = [n.id for n in flow_state.nodes if n.id.startswith("center_")]
                if centers:
                    flow_state.edges.append(make_edge(centers[-1], node.id))

    st.divider()
    with st.expander("Barrier (preventive / mitigative)", expanded=False):
        b_label = st.text_input("Barrier label (e.g., 🛡️ PSV, SOP)", key="bar_lbl")
        b_type = st.selectbox("Barrier type", ["preventive", "mitigative"], index=0, key="bar_type")
        b_eff = st.slider("Barrier effectiveness (%)", 0, 100, 0, key="bar_eff")
        src_pick = st.selectbox("Upstream node (source)", options=["(none)"] + [n.id for n in flow_state.nodes], index=0)
        tgt_pick = st.selectbox("Downstream node (target) — pick a node or (Top Event)",
                                options=["(Top Event)"] + [n.id for n in flow_state.nodes], index=0)
        if st.button("Add Barrier"):
            node = make_barrier_node(b_label, b_type, b_eff)
            flow_state.nodes.append(node)
            if src_pick != "(none)":
                flow_state.edges.append(make_edge(src_pick, node.id))
            if tgt_pick == "(Top Event)":
                centers = [n.id for n in flow_state.nodes if n.id.startswith("center_")]
                if centers:
                    flow_state.edges.append(make_edge(node.id, centers[-1]))
            else:
                flow_state.edges.append(make_edge(node.id, tgt_pick))

# ======================== RIGHT: edit / edges / icons / I/O ========================
with right:
    st.subheader("Edit / Delete")

    if flow_state.nodes:
        # Prefer a node selected on the canvas, if available
        selected_ids = get_selected_node_ids(st.session_state.flow_state)
        default_index = 0
        if len(selected_ids) == 1:
            for i, n in enumerate(flow_state.nodes):
                if n.id == selected_ids[0]:
                    default_index = i
                    break

        picked_id = st.selectbox(
            "Pick a node to edit",
            options=[n.id for n in flow_state.nodes],
            index=default_index,
            key="edit_pick",
        )
        node = next(n for n in flow_state.nodes if n.id == picked_id)

        # Text edit
        new_content = st.text_area(
            "Content (Markdown & basic HTML allowed)",
            node.data.get("base_content", node.data.get("content", "")),
            height=110,
            key=f"content_{picked_id}",
        )

        colA, colB = st.columns(2)
        with colA:
            if st.button("Update node", key=f"update_{picked_id}"):
                node.data["base_content"] = new_content
                node.data["content"] = render_node_content(node.id, new_content)
                st.session_state.flow_state = flow_state
        with colB:
            if st.button("Delete node", type="secondary", key=f"delete_{picked_id}"):
                flow_state.nodes = [n for n in flow_state.nodes if n.id != picked_id]
                flow_state.edges = [e for e in flow_state.edges if e.source != picked_id and e.target != picked_id]
                st.session_state.details.pop(picked_id, None)
                st.session_state.expanded_ids.discard(picked_id)
                st.session_state.flow_state = flow_state

        # Risk controls
        st.markdown("### Risk (optional)")
        meta = node.data.setdefault("meta", {})
        sev = st.slider("Severity", 1, 5, value=int(meta.get("severity", 3)), key=f"sev_{picked_id}")
        lik = st.slider("Likelihood", 1, 5, value=int(meta.get("likelihood", 3)), key=f"lik_{picked_id}")

        if picked_id.startswith("barrier_"):
            eff = st.slider("Barrier effectiveness (0–100%)", 0, 100,
                            value=int(meta.get("effectiveness", 0)), key=f"eff_{picked_id}")
            btype = st.selectbox("Barrier type", ["preventive", "mitigative"],
                                 index=0 if meta.get("barrier_type","preventive")=="preventive" else 1,
                                 key=f"btype_{picked_id}")

        if st.button("Save risk", key=f"risk_{picked_id}"):
            meta["severity"] = int(sev)
            meta["likelihood"] = int(lik)
            if picked_id.startswith("barrier_"):
                meta["effectiveness"] = int(eff)
                meta["barrier_type"] = btype
            st.session_state.flow_state = flow_state

        # ---- Hidden bullets editor ----
        st.markdown("### Details (hidden bullets)")
        node_id = node.id
        existing = st.session_state.details.get(node_id, [])

        if existing:
            st.markdown("Current bullets:")
            for i, b in enumerate(existing):
                cols = st.columns([1, 7, 1, 1])
                with cols[0]:
                    st.markdown(f"**{i+1}.**")
                with cols[1]:
                    edited = st.text_input("", value=b, key=f"bullet_txt_{node_id}_{i}", label_visibility="collapsed")
                with cols[2]:
                    if st.button("Save", key=f"save_b_{node_id}_{i}"):
                        lst = st.session_state.details.get(node_id, [])
                        if 0 <= i < len(lst):
                            lst[i] = edited
                            st.session_state.details[node_id] = lst
                            base = node.data.get("base_content", node.data.get("content", ""))
                            node.data["content"] = render_node_content(node_id, base)
                            st.session_state.flow_state = flow_state
                            st.rerun()
                with cols[3]:
                    if st.button("✕", key=f"del_b_{node_id}_{i}", help="Remove bullet"):
                        lst = st.session_state.details.get(node_id, [])
                        if 0 <= i < len(lst):
                            lst.pop(i)
                            st.session_state.details[node_id] = lst
                        base = node.data.get("base_content", node.data.get("content", ""))
                        node.data["content"] = render_node_content(node_id, base)
                        st.session_state.flow_state = flow_state
                        st.rerun()

        new_bullet = st.text_input("Add bullet", key=f"add_bullet_{node_id}")
        add_cols = st.columns([1, 1])
        with add_cols[0]:
            if st.button("Add", key=f"add_b_{node_id}"):
                txt = new_bullet.strip()
                if txt:
                    st.session_state.details.setdefault(node_id, []).append(txt)
                    base = node.data.get("base_content", node.data.get("content", ""))
                    node.data["content"] = render_node_content(node_id, base)
                    st.session_state.flow_state = flow_state
                    st.rerun()
        with add_cols[1]:
            expanded_now = node_id in st.session_state.expanded_ids
            toggle = st.toggle("Show on canvas", value=expanded_now, key=f"exp_toggle_{node_id}")
            if toggle != expanded_now:
                if toggle:
                    st.session_state.expanded_ids.add(node_id)
                else:
                    st.session_state.expanded_ids.discard(node_id)
                base = node.data.get("base_content", node.data.get("content", ""))
                node.data["content"] = render_node_content(node_id, base)
                st.session_state.flow_state = flow_state
                st.rerun()

    st.divider()
    st.markdown("**Connect nodes**")
    if flow_state.nodes:
        src = st.selectbox("Source", [n.id for n in flow_state.nodes], key="edge_src")
        tgt = st.selectbox("Target", [n.id for n in flow_state.nodes], key="edge_tgt")
        if st.button("Add edge", key="add_edge"):
            if src != tgt and all(not (e.source == src and e.target == tgt) for e in flow_state.edges):
                flow_state.edges.append(make_edge(src, tgt))
                st.session_state.flow_state = flow_state
            else:
                st.warning("Duplicate or self-loop edge not added.")

    if flow_state.edges:
        to_del = st.selectbox("Delete edge", [f"{e.id}: {e.source} ➜ {e.target}" for e in flow_state.edges], key="edge_del_pick")
        if st.button("Delete selected edge", type="secondary", key="edge_del_btn"):
            del_id = to_del.split(":")[0]
            flow_state.edges = [e for e in flow_state.edges if e.id != del_id]
            st.session_state.flow_state = flow_state

    st.divider()
    st.subheader("Custom Icons")
    with st.expander("Upload icons (PNG or SVG)"):
        up_thr = st.file_uploader("Threat icon", type=["png", "svg"], key="ic_thr")
        up_con = st.file_uploader("Consequence icon", type=["png", "svg"], key="ic_con")
        up_bar = st.file_uploader("Barrier icon", type=["png", "svg"], key="ic_bar")

        if up_thr:
            st.session_state.icons["threat"] = to_data_uri(up_thr.read(), up_thr.name)
        if up_con:
            st.session_state.icons["consequence"] = to_data_uri(up_con.read(), up_con.name)
        if up_bar:
            st.session_state.icons["barrier"] = to_data_uri(up_bar.read(), up_bar.name)

        prev_cols = st.columns(3)
        with prev_cols[0]:
            st.markdown("**Threat**")
            st.markdown(icon_markup("threat") if st.session_state.icons["threat"] else "⚠️")
        with prev_cols[1]:
            st.markdown("**Consequence**")
            st.markdown(icon_markup("consequence") if st.session_state.icons["consequence"] else "❗")
        with prev_cols[2]:
            st.markdown("**Barrier**")
            st.markdown(icon_markup("barrier") if st.session_state.icons["barrier"] else "🛡️")
        st.caption("New nodes will use your uploaded icons. Edit existing nodes to refresh content if needed.")

    st.divider()
    st.subheader("Save / Load")
    blob = state_to_jsonable(flow_state)
    st.download_button(
        "Download diagram JSON",
        data=json.dumps(blob, indent=2).encode("utf-8"),
        file_name="bowtie.json",
        mime="application/json",
        key="dl_json",
    )
    up_json = st.file_uploader("Load from JSON", type=["json"], key="load_json")
    if up_json:
        try:
            data = json.loads(up_json.read().decode("utf-8"))
            st.session_state.flow_state = jsonable_to_state(data)
            # Recompute right after load
            compute_residuals_aggregated(st.session_state.flow_state)
            st.success("Loaded diagram from JSON.")
            st.rerun()
        except Exception as e:
            st.error(f"Could not load file: {e}")

# ======================== MIDDLE: canvas (render LAST) ========================
with middle:
    st.subheader("Canvas")
    st.caption("Drag to reposition, scroll to zoom. Click nodes/edges to select.")
    # Compute aggregated model every render to keep colors & badges in sync
    compute_residuals_aggregated(flow_state)
    flow_state = streamlit_flow(key="bowtie", state=st.session_state.flow_state, height=900)
    st.session_state.flow_state = flow_state
