# rf_bowtie_app.py

import json
from uuid import uuid4

import streamlit as st

from bowtie_flow_component import bowtie_flow

st.set_page_config(page_title="Bow-Tie ReactFlow Prototype", layout="wide")
st.title("Bow-Tie Builder — React Flow Component with Risk Logic")


def uid(prefix: str = "n") -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


# ---------- Initial graph (session defaults) ----------

if "rf_nodes" not in st.session_state:
    # One center (Top Event) node as a starting point
    st.session_state.rf_nodes = [
        {
            "id": uid("center"),
            "type": "default",
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

nodes = st.session_state.rf_nodes
edges = st.session_state.rf_edges

# ---------- Save / Load controls (replaces Graph JSON panel) ----------

st.subheader("Save / Load bowtie")

col1, col2 = st.columns(2)

with col1:
    payload = {"nodes": nodes, "edges": edges}
    json_bytes = json.dumps(payload, indent=2).encode("utf-8")

    st.download_button(
        "💾 Download bowtie JSON",
        data=json_bytes,
        file_name="bowtie_graph.json",
        mime="application/json",
        help="Save the current bowtie diagram as a JSON file.",
    )

with col2:
    uploaded = st.file_uploader(
        "Upload bowtie JSON",
        type=["json"],
        help="Upload a previously saved bowtie_graph.json file.",
    )
    if uploaded is not None:
        try:
            loaded = json.load(uploaded)
            st.session_state.rf_nodes = loaded.get("nodes", [])
            st.session_state.rf_edges = loaded.get("edges", [])
            st.success("Bowtie loaded from file.")
            # No st.rerun() needed – Streamlit already reruns this script
        except Exception as e:
            st.error(f"Could not load JSON: {e}")

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

# Optional help text
st.markdown(
    """
**Canvas controls**

- Right-click on empty canvas → create a node (Threat / Barrier / Consequence / Top Event)  
- Right-click a node → collapse/expand branch, delete node  
- Right-click a connection → delete connection  
- Drag from a node handle to another node → create an edge  
- Drag nodes to reposition them  

Risk is calculated live on the frontend:
- Threats: Base S×L minus preventive barriers  
- Top Event: Σ threat residuals (only connected threats)  
- Consequences: Top Event residual × (S×L), minus mitigative barriers  
"""
)
