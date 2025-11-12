import os
import json
from typing import Any, Dict, List, Tuple

import streamlit as st
import streamlit.components.v1 as components

_IS_DEV = bool(os.environ.get("BOWTIE_DEV"))

if _IS_DEV:
    dev_url = os.environ.get("BOWTIE_DEV_URL", "http://localhost:3000")
    st.write(f"bowtie_flow_component running in DEV mode, url={dev_url}")
    _bowtie_flow_impl = components.declare_component(
        "bowtie_flow",   # <-- SIMPLE NAME
        url=dev_url,
    )
else:
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend", "dist")
    _bowtie_flow_impl = components.declare_component(
        "bowtie_flow",
        path=frontend_dir,
    )



def bowtie_flow(
    *,
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    height: int = 800,
    key: str = "bowtie_rf",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Render the ReactFlow bowtie component."""
    nodes_json = json.dumps(nodes)
    edges_json = json.dumps(edges)

    result = _bowtie_flow_impl(
        nodes=nodes_json,
        edges=edges_json,
        height=height,
        key=key,
        default={"nodes": nodes, "edges": edges},
    )

    if result is None:
        return nodes, edges

    if isinstance(result, str):
        try:
            result = json.loads(result)
        except Exception:
            return nodes, edges

    new_nodes = result.get("nodes", nodes)
    new_edges = result.get("edges", edges)
    return new_nodes, new_edges
