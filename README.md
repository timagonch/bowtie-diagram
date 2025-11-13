# 🧠 Bow-Tie Risk Visualizer (ReactFlow + Streamlit)

An advanced **Bow-Tie Risk Diagram Builder** that supports hazards, threats, preventive & mitigative barriers, consequences, live breach propagation, branch collapsing, barrier metadata, spotlight highlighting, PNG export, and JSON save/load.

Built with:

- **ReactFlow** (visual graph engine)  
- **Streamlit** (Python host app)  
- A custom Streamlit component in `bowtie_flow_component/frontend`

---

## 🗂️ Project Structure

```
BOWTIE/
│
├── bowtie_flow_component/
│   ├── __init__.py
│   ├── component.py
│   └── frontend/
│       ├── src/
│       │   └── index.jsx      ← Full Bowtie ReactFlow editor
│       ├── index.html
│       ├── package.json
│       ├── node_modules/
│       └── dist/
│
├── rf_bowtie_app.py         ← Streamlit app
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

## 🚀 Running the App

You must run **two terminals**: React frontend + Streamlit backend.

---

### 1️⃣ Clone the repo

```bash
git clone https://github.com/<your-username>/<repo>.git
cd <repo>
```

---

### 2️⃣ Install Python dependencies

```bash
uv sync
```

Creates `.venv` and installs dependencies.

---

### 3️⃣ Install frontend dependencies

```bash
cd bowtie_flow_component/frontend
npm install
```

---

### 4️⃣ Start both servers

#### Terminal 1 — ReactFlow dev server

```bash
npm run dev
```

Runs at `http://localhost:3000` (or next available port).

#### Terminal 2 — Streamlit backend

```bash
uv run streamlit run rf_bowtie_app.py
```

Opens:

```
http://localhost:8501
```

> ⚠ **Keep both terminals running** while using the app.

---

## 🎨 Editor Features

### Node Types
- **🎯 Top Event** (pulsates red when breached)
- **⚠ Hazard** — connects from the **top** into the Top Event  
- **⚠ Threat**
- **🛡 Barrier** (preventive / mitigative)
- **❗ Consequence**

---

## ✏️ Node Editing (Double-Click)

All nodes support text editing.  
Barriers additionally support:

- Preventive / Mitigative  
- Human / Hardware / Human–Hardware  
- Responsible Party  
- Failure State (Active / Failed)  
- Auto-generated metadata block beneath the label  

Hazards & Top Event support label-only editing.

---

## 🖱 Right-Click Menus

### On empty canvas
- Add Threat / Barrier / Hazard / Consequence / Top Event

### On nodes
- Edit node  
- Collapse / Expand threat branch  
- Collapse / Expand consequence branch  
- Mark barrier as Active / Failed  
- Hide / Show barrier metadata  
- Highlight / Unhighlight branch (spotlight mode)  
- Delete node  

### On edges
- Highlight / Unhighlight branch  
- Insert barrier into that edge (auto-splitting)  
- Delete connection  
- Synthetic collapse edges cannot be deleted manually

---

## 🔥 Breach Detection Logic

### Threat → Top Event
A threat path is **breached** if:

- All preventive barriers on that path are **failed**, or  
- There are **no barriers**

When breached:
- Path edges turn **red & animated**
- Threat becomes breached
- Top Event pulses red and is marked breached

### Top Event → Consequence
If Top Event is breached:
- Breach propagates **rightward**
- Stops at **active mitigative barriers**
- Continues through **failed mitigative barriers**
- Consequences reached by a breach become breached

### Hazard Behavior
If Top Event is breached:
- All hazards feeding it become breached  
- Hazards always connect from **top → Top Event**

---

## 🔽 Branch Collapsing

### Threat Collapsing
- Hides all nodes **between Threat → Top Event**  
- Adds synthetic short-cut edge Threat → Top Event  
- Synthetic edge preserves breach coloring

### Consequence Collapsing
- Hides mitigative barriers **between Top Event → Consequence**  
- Adds synthetic Top Event → Consequence shortcut  
- Breach styling preserved

Both collapse types are independent.

---

## 🔦 Branch Highlighting (Spotlight Mode)

Highlighting a branch:
- Selected path → full opacity and color  
- Everything else becomes **50% transparent + grayscale**  
- Toggle again to remove highlight

---

## 💾 Exporting & Importing

### Export JSON
- Reconstructable structure  
- Preserves positions  
- Includes barrier metadata  
- Excludes synthetic collapse edges

### Import JSON
- Fully rehydrated  
- Recalculates breach states  
- Clears collapse state on load

### Save PNG
- High-resolution export  
- Canvas only (menus & toolbars excluded)  
- Uses your custom background color  

---

## 🧭 Canvas Controls

- Right-click empty space → create node  
- Drag nodes to reposition  
- Drag handles to connect nodes  
- Right-click edges → manage connection  
- Scroll / pinch / drag → navigate  
- MiniMap & Controls included  
- Optional background grid (dots / lines / cross)  
- Adjustable background + grid colors  

---

## 👥 Credits

**Bow-Tie Risk Visualizer**  
UNC Charlotte · Visual Storytelling · Fall 2025  

Author: **Timothy Goncharov**
