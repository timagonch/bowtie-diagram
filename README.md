# 🧠 Bow-Tie Risk Visualizer (ReactFlow + Streamlit)

An interactive **Bow-Tie Risk Diagram Builder** built with:

- **Streamlit** (Python)
- **ReactFlow** (React / JavaScript)
- A custom Streamlit component in `bowtie_flow_component/frontend`

You can create, connect, collapse, and expand threats, barriers, and consequences — and save or reload bowties as JSON files.

---

## 🗂️ Project Structure

```text
BOWTIE/
│
├── bowtie_flow_component/
│   ├── __init__.py
│   ├── component.py
│   └── frontend/
│       ├── src/
│       │   └── index.jsx
│       ├── index.html
│       ├── package.json
│       ├── package-lock.json
│       ├── node_modules/
│       └── .parcel-cache / dist
│
├── rf_bowtie_app.py
├── pyproject.toml
├── uv.lock
└── README.md
```

---

## ⚙️ Requirements

You need both **Python** and **Node.js**.

### Python

- Python **3.9+**
- [`uv`](https://github.com/astral-sh/uv) (Python dependency manager)

### JavaScript

- [Node.js](https://nodejs.org/) (LTS is fine)
- `npm` (comes with Node)

---

## 🚀 Setup & Run

You will run **two terminals**:

1. **Frontend (React)** — runs the visual editor
2. **Backend (Streamlit)** — runs the Python app

### 1️⃣ Clone the repo

```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
```

### 2️⃣ Python setup (with uv)

From the repo root:

```bash
uv sync
```

This creates `.venv` and installs all Python dependencies defined in `pyproject.toml` / `uv.lock`.

### 3️⃣ Frontend setup (Node / npm)

From the repo root:

```bash
cd bowtie_flow_component/frontend
npm install
```

This installs the JS dependencies into `bowtie_flow_component/frontend/node_modules`.

### 4️⃣ Run both servers

Open **two terminals**.

**Terminal 1 – Frontend dev server**

From `bowtie_flow_component/frontend`:

```bash
npm run dev
```

Leave this running. It serves the ReactFlow frontend (usually on `http://localhost:3000` or `3001`).

**Terminal 2 – Streamlit app**

From the repo root:

```bash
cd <repo-name>
uv run streamlit run rf_bowtie_app.py
```

Then open the URL printed in the terminal, typically:

```text
http://localhost:8501
```

Keep **both** terminals running while you use the app.

---

## 💾 Saving & Loading Bow-Tie Graphs

Inside the Streamlit app:

- **Save your diagram**
  - Click **“💾 Download bowtie JSON”**
  - This downloads a file like `bowtie_graph.json`

- **Load a saved diagram**
  - Click **“Upload bowtie JSON”**
  - Select a previously saved `bowtie_graph.json` file to reload that bowtie

The JSON format is:

```json
{
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

---

## 🧭 Canvas Controls

**On the canvas:**

- Right-click **empty space** → create a node  
  (Threat / Barrier / Consequence / Top Event)
- Right-click **a node** → node actions:  
  - Collapse / expand branch (for a valid Threat → Barrier(s) → Top Event path)  
  - Delete node (removes its connections)
- Right-click **a connection (edge)** → delete that connection
- Drag from a node **handle** → create a new connection to another node
- Drag **nodes** → reposition them

**Risk logic (calculated live in the frontend):**

- **Threats**  
  Base risk = `Severity × Likelihood`  
  Preventive barriers reduce this via their effectiveness (%)

- **Top Event**  
  Current risk = sum of residual risks of all **connected** threats

- **Consequences**  
  Risk = (Top Event residual) × (Consequence Severity × Likelihood)  
  Mitigative barriers reduce this via their effectiveness (%)

---

## 🧰 Troubleshooting

- **Blank canvas / component not loading**
  - Check that `npm run dev` is still running and not showing errors.
  - Make sure you’re on the correct URL (`http://localhost:8501`).

- **Upload doesn’t change the diagram**
  - Confirm the file is valid JSON and has both `"nodes"` and `"edges"` keys.
  - Try refreshing the browser tab once.

- **Python dependency issues**
  - Run `uv sync` again from the repo root.

- **Port already in use**
  - Either Streamlit or the dev server port is taken. Stop the other process or run on a different port (e.g. `npm run dev -- --port 3005`).

---

## 👥 Credits

**Bow-Tie Risk Visualizer**  
UNC Charlotte · Visual Storytelling · Fall 2025  

Author: **Timothy Goncharov**
