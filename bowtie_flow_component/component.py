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
    parent_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(parent_dir, "frontend", "dist")

    st.write("bowtie_flow_component using frontend dir:", dist_dir)
    st.write("dist exists:", os.path.isdir(dist_dir))
    if os.path.isdir(dist_dir):
        try:
            st.write("dist contents:", os.listdir(dist_dir))
        except Exception as e:
            st.write("Could not list dist contents:", e)

    _bowtie_flow_impl = components.declare_component(
        "bowtie_flow",   # <-- SAME SIMPLE NAME
        path=dist_dir,
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
