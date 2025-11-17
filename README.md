# 🧠 Bow-Tie Risk Visualizer (ReactFlow + Streamlit)

Modern organizations face increasingly complex operational risks, where a single failure can cascade into severe consequences. This tool provides an **interactive, logic-driven Bow-Tie risk visualization** that makes those chains of events visible and explainable.  
For example, if a **truck loses control on a highway**, you can model the hazard (e.g., “Loaded truck traveling on wet road”), threats (e.g., “Loss of braking”), preventive barriers, the **Top Event** (“Truck loses control on highway”), mitigative barriers, and consequences. As barriers fail in the model, the bow-tie visually shows which paths breach the Top Event and how far the consequences propagate.  
By simulating barrier performance, highlighting breach paths, and collapsing complex branches, this visualizer helps companies identify where controls truly matter and communicate risk in a way non-technical stakeholders can understand.

👉 Live prototype: **https://bowtie-diagram.streamlit.app/**

---

## 🛡️ What This Tool Does

The **Bow-Tie Risk Visualizer** is an advanced Bow-Tie diagram builder that supports:

- **Hazards, Threats, Preventive Barriers, Mitigative Barriers, Consequences**
- Live **breach detection and propagation** from threat → Top Event → consequences
- **Hazard → Top Event** wiring assumptions (hazards feed into the top of the Top Event)
- **Branch collapsing** (threat side and consequence side) with synthetic shortcut edges
- **Barrier metadata**: type, medium, responsible party, and failure state
- **Spotlight highlighting** for a single branch (dims all others)
- **JSON export & import** (schema-style structure, collapse-safe)
- **PNG export** of the canvas (no overlays, suitable for reports)
- Configurable **canvas & grid styling** (background, grid type, spacing)

Technically, it is built with:

- **ReactFlow** (visual graph engine)
- **Streamlit** (Python host application)
- A custom Streamlit component in `bowtie_flow_component/frontend`

---

## 🗂️ Project Structure

```text
BOWTIE/
│
├── bowtie_flow_component/
│   ├── __init__.py
│   ├── component.py                 # Streamlit ↔ React bridge
│   └── frontend/
│       ├── src/
│       │   └── index.jsx            # Full Bow-Tie ReactFlow editor
│       ├── index.html
│       ├── package.json
│       ├── node_modules/
│       └── dist/
│
├── rf_bowtie_app.py                 # Streamlit host app
├── pyproject.toml
├── uv.lock
└── README.md
```

---

## ⚙️ Requirements

### Python

- Python **3.9+**
- [`uv`](https://github.com/astral-sh/uv)

### JavaScript

- Node.js (LTS recommended)
- npm

---

## 🚀 Getting Started

You will typically run **two processes**: a React dev server and a Streamlit app.

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/timagonch/bowtie-diagram.git
cd bowtie-diagram
```

### 2️⃣ Install Python Dependencies

```bash
uv sync
```

Creates and manages a `.venv` based on `pyproject.toml`.

### 3️⃣ Install Frontend Dependencies

```bash
cd bowtie_flow_component/frontend
npm install
```

### 4️⃣ Run the App

In **Terminal 1** (React dev server):

```bash
npm run dev
```

In **Terminal 2** (Streamlit backend, from project root):

```bash
uv run streamlit run rf_bowtie_app.py
```

Open Streamlit at:

```text
http://localhost:8501
```

> Keep **both** processes running while using the editor.

---

## 🎨 Node Types & Visual Design

### Node Types

- **🎯 Top Event (center)**  
  - Represents the central event (e.g., *“Truck loses control on highway”*).  
  - Pulses red when breached.

- **⚠ Hazard**  
  - Represents underlying hazardous conditions (e.g., *“Loaded truck in bad weather”*).  
  - Connects from **above → into the top** of the Top Event.  
  - Rendered as a **triangle** with **black and yellow diagonal hazard stripes**.

- **🔥 Threat**  
  - Events on the **left side** that can trigger the Top Event (e.g., *“Loss of braking effectiveness”*).  
  - Uses the same node family but styled as a rectangular “threat” box.

- **🛡 Barrier**  
  - Two kinds:
    - **Preventive** – between Threats and the Top Event.  
    - **Mitigative** – between the Top Event and Consequences.  
  - Metadata includes:
    - Medium: Human / Hardware / Human–Hardware  
    - Responsible Party  
    - Status: Active / Failed  

- **❗ Consequence**  
  - Outcomes on the **right side** if the Top Event occurs.

---

## ✏️ Editing & Building Diagrams

### Adding Nodes

- **Right-click empty canvas** → Add:
  - Threat  
  - Barrier  
  - Hazard  
  - Consequence  
  - Top Event  

### Editing Nodes

Right-click → **Edit…** (primary workflow)

Hazard & Top Event:  
- Label only

Barrier metadata:  
- Type  
- Medium  
- Responsible party  
- Status (active/failed)  
- Show/hide metadata block

### Connecting Nodes

- Drag between node handles
- Hazards connect **from bottom → Top Event top**
- Threats connect on left
- Consequences connect on right

---

## 🔥 Breach Logic & Visual Feedback

### Threat → Top Event

A Threat path breaches if:

- No barriers exist, or  
- All barriers on the path are **failed**

Effects:

- Path edges turn **animated red**
- Threat node becomes breached
- Top Event pulses red
- Hazards feeding a breached Top Event show **red-tinted stripes**

---

### Top Event → Consequence

If the Top Event is breached:

- Red propagates rightward
- Stops at **active mitigative barriers**
- Continues through **failed** mitigative barriers
- Consequences reached become breached

---

## 🔽 Branch Collapsing

### Threat Collapse

- Hides nodes between **Threat → Top Event**
- Creates synthetic shortcut
- Preserves breach color if breached

### Consequence Collapse

- Hides nodes between **Top Event → Consequence**
- Creates synthetic shortcut

---

## 🔦 Spotlight Highlighting

Right-click → **Highlight branch**

- Highlight path = full color  
- All other branches dim to ~25% opacity + grayscale  
- Toggle again to remove  

---

## 💾 Export, Import & PNG

### JSON Export

- Saves:
  - Node positions  
  - Labels  
  - Metadata  
  - Canonical edges  
- Does **not** save synthetic collapse edges

### JSON Import

- Restores nodes & edges  
- Recomputes breach logic  
- Resets collapse state

### PNG Export

- High-resolution  
- Excludes UI overlays  
- Uses canvas background color  

---

## 🧭 Canvas Controls

- **Right-click empty** → Add node  
- **Right-click node** → Edit / collapse / highlight / delete / barrier actions  
- **Right-click edge** → Highlight / insert barrier / delete  
- Drag nodes or edges  
- Scroll/drag to navigate  
- Grid customization: dots / lines / cross + color + spacing  

---

## 👥 Project Team

**Bow-Tie Risk Visualizer**  
UNC Charlotte — DSBA 5122 — Fall 2025  

**Team Members:**

- **Timothy Goncharov**
- **Shamsa Yusuf**
- **Daniel Miller**
- **Vyncent Harris**

---

## 🏛️ Acknowledgement

**Acknowledgement:**  
*This is a student project developed for DSBA 5122 in collaboration with Todus Advisors. Bowtie Symbols are proprietary of Todus Advisors.*
