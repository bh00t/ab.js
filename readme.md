# ab.js
![Live Site](https://img.shields.io/badge/Live_Site-ab--js.demo-00a8e8?logo=github&style=flat-square) ![Dependencies](https://img.shields.io/badge/Dependencies-Zero-ff6b6b?style=flat-square) ![Platform](https://img.shields.io/badge/Platform-HTML5_Canvas-00a8e8?style=flat-square) ![Tech](https://img.shields.io/badge/Tech-Vanilla_JS-007acc?style=flat-square)

> **High-performance data lineage engine · Zero-dependency math · Built for complex DAG visualization**

## What is ab.js?

**ab.js** is a production-grade, lightweight visualization engine designed specifically for **Data Lineage** and **Complex DAGs** (Directed Acyclic Graphs). Unlike standard libraries that rely on heavy physics simulations, ab.js uses purely deterministic geometric math to render thousands of nodes with sub-millisecond layout times.

The project was built to solve a specific problem: **Visualizing SQL transformations without the "spaghetti" mess.**

> [!IMPORTANT]
> **Origins:** ab.js was originally developed as a core feature of **Redshift Lens**. Due to its high performance and reliability, the engine was later decoupled and made generic, allowing it to be used in any data lineage or DAG-based application.

## Interactive Features

The engine provides a premium, "IDE-like" experience for data engineers:

* **End-to-End Highlighting:** Click any node to trace its entire lineage. Upstream dependencies glow **Blue**; downstream impacts glow **Green**.
* **Smart Edge Routing:** Cubic Bezier curves with dynamic "port spreading" to prevent overlapping lines at node faces.
* **Marquee Selection:** Box-select multiple nodes to move them as a group.
* **Directional Modes:** Switch between **Left-to-Right** and **Top-to-Bottom** layouts instantly.
* **Refined Dark Theme:** High-contrast optimization with a subtle grid system designed for professional data environments.

## Architecture
The engine logic is strictly modular, separating data processing from coordinate math and canvas painting.

![architecture](renderer__html5_canvas___ab_js.png)

### Modular Components

| Module | Responsibility |
| :--- | :--- |
| **DataParser** | Standardizes incoming JSON into an internal graph map. |
| **LayoutEngine** | Calculates X/Y coordinates using topological sorting and crossing reduction. |
| **EdgeRouter** | Calculates tangent angles and port offsets for connecting lines. |
| **Renderer** | Handles high-DPI canvas painting, typography, and theme-aware styling. |

## Performance Proof

The engine enforces an **Inter-Layer Safe Zone** to guarantee zero node overlapping:

* **Layer Spacing:** 350px
* **Max Aesthetic Distortion:** 185px (Arc + Stagger)
* **Result:** A minimum **131-pixel** "impenetrable zone" between tiers, ensuring readability at any scale.

## Repo Structure

```
ab-js/
├── index.html       # UI Shell & Event Handlers
├── ab.js            # Core Engine Logic & Layout Math
└── README.md        # Project Documentation
```

## Getting Started

1. **Clone the repository:**
   `git clone https://github.com/your-username/ab-js.git`
2. Ensure index.html and ab.js are in the same folder.
3. Open index.html in any modern web browser.
4. Paste your graph data into the **Load JSON** modal to render your lineage.

---
_ab.js · Born from Redshift Lens · Built for Data Engineers · Pure Math · High Performance_