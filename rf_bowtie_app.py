# rf_bowtie_app.py

import json
from uuid import uuid4
import base64

import streamlit as st

from bowtie_flow_component import bowtie_flow

st.set_page_config(page_title="Bowtie Diagram Builder", layout="wide")
st.title("Bowtie Diagram Builder")


def uid(prefix: str = "n") -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


# ---------- Initial graph (session defaults) ----------

if "rf_nodes" not in st.session_state:
    # One center (Top Event) node as a starting point
    st.session_state.rf_nodes = [
        {
            "id": uid("center"),
            "type": "topEvent",
            "data": {
                "label": "🎯 Top Event",
                "baseLabel": "🎯 Top Event",
                "meta": {
                    "kind": "center",
                    "severity": 3,
                    "likelihood": 3,
                },
            },
            "position": {"x": 0, "y": 0},
            "sourcePosition": "right",
            "targetPosition": "left",
            "style": {
                "padding": 10,
                "borderRadius": 12,
                "border": "2px solid #555",
                "background": "#ffffff",
            },
        }
    ]

if "rf_edges" not in st.session_state:
    st.session_state.rf_edges = []

# Convenience variables
nodes = st.session_state.rf_nodes
edges = st.session_state.rf_edges

st.markdown("---")

# ---------- Canvas ----------

st.subheader("Canvas")

new_nodes, new_edges = bowtie_flow(
    nodes=st.session_state.rf_nodes,
    edges=st.session_state.rf_edges,
    height=800,
    key="bowtie_rf",
)

# Update session with whatever the frontend sent back
st.session_state.rf_nodes = new_nodes
st.session_state.rf_edges = new_edges

st.markdown(
"""
### Canvas controls

- **Right-click empty canvas** → add a node *(Threat / Barrier / Hazard / Consequence / Top Event)*  
- **Right-click a node** → collapse/expand branch (threats), collapse/expand consequence branch, toggle barrier failed/active, show/hide barrier metadata, highlight/unhighlight branch, delete node, edit
- **Right-click a connection (edge)** → highlight/unhighlight branch, **insert a barrier** at the midpoint, delete connection
- **Double-click a node** → open edit panel *(barriers include type/medium/responsible/status)*
- **Drag** nodes to reposition
- **Connect** by dragging from one handle to another

**Special logic & visuals**
- **Hazard** nodes connect **from the bottom** into the **top** of the Top Event.
- If a **Threat → Top Event** path has **no barriers** or **all barriers are failed**, that branch **breaches**:
  - All edges on that path turn **bright red** and animate.
  - The **Top Event pulses red** (soft ring animation).
  - Hazards feeding a breached Top Event render with **red-tinted hazard stripes**.
- If the Top Event is breached, edges from **Top Event → Consequences** turn red until a **mitigative barrier** is encountered.  
  - If that mitigative barrier **failed**, red continues to the consequence (consequence turns red).
- **Branch highlight** dims all other branches to ~25% opacity and slightly desaturates them.
- **Threat collapse** hides nodes **between the Threat and the Top Event** on that path and adds a temporary shortcut edge (stays red if the branch is breached).
- **Consequence collapse** hides mitigative barriers between **Top Event → that consequence** and adds a temporary shortcut.

**Saving / Loading**
- Use the **Export JSON** / **Import JSON** buttons (top-left of the canvas toolbar).  
  *(The old Save/Load panel has been removed.)*
"""
)

