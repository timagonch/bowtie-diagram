# bowtie_flow_component/component.py
from pathlib import Path
import json
import streamlit as st
import streamlit.components.v1 as components

# In dev, point to the Parcel dev server
_bowtie_flow = components.declare_component(
    "bowtie_flow",
    url="http://localhost:1234",  # Parcel dev server
    # For a built version later, you’d switch to:
    # path=str((Path(__file__).parent / "frontend").absolute()),
)

def bowtie_flow(nodes, edges, height=700, key=None):
    """
    Streamlit wrapper for the custom React Flow component.

    nodes: list[dict]  - React Flow nodes
    edges: list[dict]  - React Flow edges
    height: int        - canvas height in px
    key: str           - Streamlit key
    """
    data = {
        "nodes": nodes,
        "edges": edges,
        "height": height,
    }

    result = _bowtie_flow(
        nodes=json.dumps(nodes),
        edges=json.dumps(edges),
        height=height,
        key=key,
        default=data,
    )

    if result is None:
        return nodes, edges

    new_nodes = result.get("nodes", nodes)
    new_edges = result.get("edges", edges)
    return new_nodes, new_edges
