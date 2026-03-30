// ============================================================================
// 1. DATA INITIALIZATION
// Contains the initial JSON payload or placeholder to be loaded by the engine.
// ============================================================================
var RAW_INPUT = { "main": "", "nodes": [], "edges": [] };

// ============================================================================
// 2. CONFIGURATION
// Holds all visual styling tokens, node sizing, and color palettes.
// ============================================================================
var LightColors = {
  DEFAULT: '#64748b', CARD_BG: '#ffffff', HIGHLIGHT: '#f43f5e',
  TEXT_MAIN: '#1e293b', TEXT_SELF: '#0f172a', TEXT_MUTED: '#64748b', LINE: '#475569', CYCLE_LINE: '#64748b',
  UPSTREAM: '#0ea5e9', DOWNSTREAM: '#10b981', BORDER: '#e2e8f0'
};

var DarkColors = {
  DEFAULT: '#94a3b8', CARD_BG: '#1e293b', HIGHLIGHT: '#fb7185',
  TEXT_MAIN: '#f8fafc', TEXT_SELF: '#ffffff', TEXT_MUTED: '#94a3b8', 
  LINE: '#334155', CYCLE_LINE: '#475569', // Darker standard lines so they recede
  UPSTREAM: '#38bdf8', DOWNSTREAM: '#34d399', BORDER: '#475569'
};

var Config = {
  BaseColors: { ...LightColors },
  LightColors,
  DarkColors,
  Palette: [
    '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', 
    '#06b6d4', '#84cc16', '#f43f5e', '#6366f1', '#14b8a6'
  ],
  Node: {
    LR_W: 175, LR_H: 56,   
    TB_W: 148, TB_H: 48,   
    RADIUS: 5              
  }
};

// ============================================================================
// 3. DATA PARSER
// Transforms raw user JSON into the standardized internal object map needed
// by the Layout Engine and Edge Router.
// ============================================================================
class DataParser {
  /**
   * Parses the input JSON and constructs the internal `nodes` and `edges` state.
   * If nodes are not explicitly provided, it automatically infers them
   * based on the edge relationships.
   */
  static parse(rawInput) {
    const nodes = {};
    const edges = [];

    // Parse explicitly defined nodes if they exist in the payload
    if (rawInput.nodes && rawInput.nodes.length > 0) {
        rawInput.nodes.forEach(def => {
            nodes[def.id] = { 
                ...def, 
                self: def.id === rawInput.main,
                x: 0, y: 0, w: Config.Node.LR_W, h: Config.Node.LR_H,
                lrX: 0, lrY: 0, tbX: 0, tbY: 0, 
                fallingLrX: 0, fallingLrY: 0,
                compactX: 0, compactY: 0,
                level: 0
            };
        });
    } 
    // Fallback: Infer nodes based solely on the array of edges
    else if (rawInput.edge || rawInput.edges) {
        const edgeList = rawInput.edge || rawInput.edges;
        const uniqueIds = new Set();
        
        edgeList.forEach(e => { 
            uniqueIds.add(e[0]); 
            uniqueIds.add(e[1]); 
        });
        
        Array.from(uniqueIds).forEach(id => {
          let schema = '';
          let name = id;
          
          // Attempt to auto-parse the schema prefix from standard conventions
          if (id.includes('__')) {
              [schema, name] = id.split('__', 2);
          } else if (id.includes('.')) {
              [schema, name] = id.split('.', 2);
          }
          
          nodes[id] = {
            id, name, schema, type: '', self: id === rawInput.main, 
            x: 0, y: 0, w: Config.Node.LR_W, h: Config.Node.LR_H,
            lrX: 0, lrY: 0, tbX: 0, tbY: 0, 
            fallingLrX: 0, fallingLrY: 0,
            compactX: 0, compactY: 0,
            level: 0
          };
        });
    }

    // Process and format edges for the engine
    const edgeList = rawInput.edges || rawInput.edge || [];
    edgeList.forEach(([f, t]) => edges.push({ f, t, key: `${f}->${t}` }));
    
    return { nodes, edges };
  }
}

// ============================================================================
// 4. LAYOUT ENGINE
// The mathematical core of the engine. Responsible for assigning X/Y coords 
// so that nodes flow logically and do not overlap.
// ============================================================================
class LayoutEngine {
  /**
   * Primary entry point. Orchestrates topological sorting, cycle detection, 
   * layer assignment, and triggers the various coordinate positioning algorithms.
   */
  static apply(state) {
    const { nodes, edges } = state;
    if (Object.keys(nodes).length === 0) return;

    // --- STEP 1: Build Adjacency List for Graph Traversal ---
    const adj = {};
    Object.keys(nodes).forEach(k => adj[k] = []);
    edges.forEach(e => { 
        if (nodes[e.f] && nodes[e.t]) {
            adj[e.f].push(e.t); 
        }
    });

    // --- STEP 2: DFS Cycle Detection ---
    // Identifies infinite loops to prevent the renderer from crashing
    const backEdges = new Set();
    const visited = new Set();
    const recStack = new Set();
    
    function dfs(u) {
      visited.add(u); 
      recStack.add(u);
      adj[u].forEach(v => { 
          if (!visited.has(v)) {
              dfs(v); 
          } else if (recStack.has(v)) {
              backEdges.add(`${u}->${v}`); 
          }
      });
      recStack.delete(u);
    }
    
    Object.keys(nodes).forEach(u => { 
        if (!visited.has(u)) dfs(u); 
    });
    
    // Tag cycle-creating edges so the renderer can draw them differently
    edges.forEach(e => { e.isBack = backEdges.has(e.key); });

    // --- STEP 3: Kahn's Algorithm (Topological Sort / Level Assignment) ---
    const inDegree = {};
    Object.keys(nodes).forEach(k => inDegree[k] = 0);
    edges.forEach(e => { 
        if (!e.isBack && nodes[e.t]) inDegree[e.t]++; 
    });
    
    const levels = {};
    Object.keys(nodes).forEach(k => levels[k] = 0);
    let queue = Object.keys(nodes).filter(k => inDegree[k] === 0);
    
    while(queue.length > 0) {
      const u = queue.shift();
      adj[u].forEach(v => { 
          if (!backEdges.has(`${u}->${v}`)) { 
              levels[v] = Math.max(levels[v], levels[u] + 1); 
              inDegree[v]--; 
              if (inDegree[v] === 0) queue.push(v); 
          } 
      });
    }
    
    state.maxLayer = 0;
    Object.keys(nodes).forEach(k => { 
        nodes[k].level = levels[k]; 
        state.maxLayer = Math.max(state.maxLayer, levels[k]); 
    });
    
    // Group nodes into physical layout layers (columns) based on their calculated level
    const layers = Array.from({length: state.maxLayer + 1}, () => []);
    Object.values(nodes).forEach(n => layers[n.level].push(n.id));

    // --- STEP 4: Barycenter Heuristic (Crossing Reduction Algorithm) ---
    // Sweeps up and down the graph 6 times to reorder nodes based on their neighbors.
    // This systematically untangles the "spiderweb" of connecting lines.
    for (let sweep = 0; sweep < 6; sweep++) {
      for(let i = 1; i <= state.maxLayer; i++) {
          layers[i].sort((a, b) => this._getAvg(a, i-1, edges, layers, true) - this._getAvg(b, i-1, edges, layers, true));
      }
      for(let i = state.maxLayer - 1; i >= 0; i--) {
          layers[i].sort((a, b) => this._getAvg(a, i+1, edges, layers, false) - this._getAvg(b, i+1, edges, layers, false));
      }
    }

    // --- STEP 5: Calculate and Store Coordinates for All Layouts ---
    // Calculate Standard Directional Layouts
    this._assignCoordinates(layers, nodes, edges, 'LR', Config.Node.LR_H + 40, 450, 30, 120);
    this._assignCoordinates(layers, nodes, edges, 'TB', Config.Node.TB_W + 35, 350, 35, 150);
    
    // Calculate Waterfall Layout
    this._assignFallingCoordinates(layers, nodes, edges, 'FALLING_LR', Config.Node.LR_H + 30, 450);

    // Calculate COMPACT Hybrid Fishbone Layout
    this._assignCompactCoordinates(layers, nodes, edges, Config.Node.LR_W + 160, Config.Node.LR_H + 90);

    // Save generated layouts so 'Reset Layout' can work if user manually drags nodes
    Object.values(nodes).forEach(n => { 
      // Apply an arbitrary padding offset from the top left corner
      n.lrX += 50; n.lrY += 50; 
      n.tbX += 50; n.tbY += 50; 
      n.fallingLrX += 50; n.fallingLrY += 50;
      n.compactX += 50; n.compactY += 50;

      // Store in memory defaults
      n.defaultLrX = n.lrX; n.defaultLrY = n.lrY;
      n.defaultTbX = n.tbX; n.defaultTbY = n.tbY;
      n.defaultFallingLrX = n.fallingLrX; n.defaultFallingLrY = n.fallingLrY;
      n.defaultCompactX = n.compactX; n.defaultCompactY = n.compactY;
    });
  }

  /**
   * Helper for DAG Barycenter: Gets the average position index of a node's connected neighbors.
   */
  static _getAvg(nodeId, adjacentLayerIdx, edges, layers, isDownward) {
    const related = edges.filter(e => !e.isBack && (isDownward ? e.t === nodeId : e.f === nodeId)).map(e => isDownward ? e.f : e.t);
    if (!related.length) return layers[isDownward ? adjacentLayerIdx+1 : adjacentLayerIdx-1].indexOf(nodeId);
    return related.reduce((acc, r) => acc + layers[adjacentLayerIdx].indexOf(r), 0) / related.length;
  }

  /**
   * Applies the core spacing math for the Standard DAGs (Left-to-Right & Top-to-Bottom).
   * Executes a greedy "plow" method to guarantee zero overlapping.
   */
  static _assignCoordinates(layers, nodes, edges, dir, GAP_CROSS, GAP_FLOW, STAGGER, MAX_ARC) {
    const isLR = dir === 'LR';
    
    layers.forEach((layer, lvlIndex) => {
      // Find the ideal center position based on parent connections
      let placed = layer.map((nodeId, i) => {
        const parents = edges.filter(e => !e.isBack && e.t === nodeId).map(e => isLR ? nodes[e.f].lrY : nodes[e.f].tbX);
        return { id: nodeId, val: parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 0 };
      });
      
      placed.sort((a, b) => a.val - b.val);
      
      // The "Plow": If nodes are overlapping, push the bottom one further down
      for (let i = 1; i < placed.length; i++) {
          if (placed[i].val < placed[i-1].val + GAP_CROSS) {
              placed[i].val = placed[i-1].val + GAP_CROSS; 
          }
      }

      // Re-center the entire column block so it aligns aesthetically with parents
      const currentAvg = placed.reduce((sum, p) => sum + p.val, 0) / placed.length;
      const targetAvg = layer.reduce((sum, nodeId) => {
        const parents = edges.filter(e => !e.isBack && e.t === nodeId).map(e => isLR ? nodes[e.f].lrY : nodes[e.f].tbX);
        return sum + (parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : 0);
      }, 0) / (layer.length || 1);
      
      const dynamicMaxArc = placed.length <= 3 ? 0 : Math.min(MAX_ARC, placed.length * 8);

      // Final coordinate assignment with aesthetic staggering and parabolic arcs
      placed.forEach((p, i) => {
        const n = nodes[p.id];
        const crossVal = p.val + (targetAvg - currentAvg);
        
        if (isLR) n.lrY = crossVal; else n.tbX = crossVal;
        
        const pairIdx = Math.floor(i / 2);
        const dist = Math.abs(pairIdx - (Math.floor((placed.length - 1) / 2) / 2));
        const arcAmt = Math.pow(dist / Math.max(1, Math.floor((placed.length - 1) / 2) / 2), 2.0) * dynamicMaxArc; 
        
        const flowVal = (lvlIndex * GAP_FLOW) + (placed.length > 3 && (i % 2 !== 0) ? STAGGER : 0) - arcAmt;
        
        if (isLR) n.lrX = flowVal; else n.tbY = flowVal;
      });
    });
  }

  /**
   * Waterfall Stepped DAG Layout.
   * Forces child nodes to align vertically with their topmost parent, letting the 
   * plow algorithm naturally cascade them downward like a staircase.
   */
  static _assignFallingCoordinates(layers, nodes, edges, dir, GAP_CROSS, GAP_FLOW) {
    const isLR = (dir === 'FALLING_LR');
    
    layers.forEach((layer, lvlIndex) => {
        let placed = layer.map(nodeId => {
            const incoming = edges.filter(e => !e.isBack && e.t === nodeId).map(e => isLR ? nodes[e.f].fallingLrY : nodes[e.f].fallingTbX);
            const targetCross = incoming.length ? Math.min(...incoming) : 0;
            return { id: nodeId, val: targetCross };
        });
        
        placed.sort((a, b) => a.val - b.val);
        
        for (let i = 1; i < placed.length; i++) {
            if (placed[i].val < placed[i-1].val + GAP_CROSS) {
                placed[i].val = placed[i-1].val + GAP_CROSS;
            }
        }
        
        placed.forEach(p => {
            const n = nodes[p.id];
            const flowVal = lvlIndex * GAP_FLOW;
            if (isLR) { 
                n.fallingLrX = flowVal; 
                n.fallingLrY = p.val; 
            } else { 
                n.fallingTbX = p.val; 
                n.fallingTbY = flowVal; 
            }
        });
    });
  }

  /**
   * COMPACT "Strict Matrix" Layout
   * - Restores the massive 10% backward allowance (-1 dx) to create tighter clusters
   * - Uses massive GAP_Y vertically so lines don't feel short and squished
   * - Uses anti-jump collision math to prevent lines from slicing through stacked nodes
   */
  static _assignCompactCoordinates(layers, nodes, edges, GAP_X, GAP_Y) {
    const nodeValues = Object.values(nodes);
    if (nodeValues.length === 0) return;

    const placed = {};
    const occupied = new Set();
    
    // Allow column to grow slightly taller before wrapping to match fishbone look
    const maxVertical = Math.max(4, Math.ceil(Math.sqrt(nodeValues.length * 0.5)));

    layers.forEach((layer, lvlIndex) => {
        layer.forEach(nodeId => {
            const n = nodes[nodeId];
            const parents = edges.filter(e => e.t === nodeId && !e.isBack).map(e => placed[e.f]).filter(Boolean);
            
            let baseX = 0;
            let baseY = 0;
            
            if (parents.length > 0) {
                // Base grid anchor is heavily influenced by the parent position
                baseX = Math.max(...parents.map(p => p.x));
                baseY = parents.reduce((sum, p) => sum + p.y, 0) / parents.length;
            } else {
                baseX = lvlIndex; 
                baseY = 0;
            }

            let bestSlot = null;
            let bestScore = Infinity;

            // Search space: 
            // dx = -1 (backwards, heavily penalized ~10% occurrence)
            // dx = 0 (perfect top-to-bottom stack)
            // dx > 0 (forward expansion)
            for (let r = 0; r < 30; r++) {
                for (let dx = -1; dx <= r; dx++) { 
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        
                        const sx = baseX + dx;
                        const sy = Math.round(baseY) + dy;
                        
                        if (occupied.has(`${sx},${sy}`)) continue;
                        
                        let score = 0;

                        if (dx === 0) {
                            // Highest Priority: Stack perfectly above/below to save horizontal area
                            score = Math.pow(Math.abs(dy), 1.2) * 10;
                            
                            // Prevent lines from jumping *over* nodes in the same vertical column
                            // (e.g. if A connects to C at y-2, ensure B is not occupying y-1)
                            let hasJumps = false;
                            if (Math.abs(dy) > 1) {
                                for (let step = 1; step < Math.abs(dy); step++) {
                                    if (occupied.has(`${sx},${Math.round(baseY) + Math.sign(dy) * step}`)) {
                                        hasJumps = true;
                                        break;
                                    }
                                }
                            }
                            // Heavy penalty to avoid slicing through an intermediate node
                            if (hasJumps) score += 600; 
                        } 
                        else if (dx > 0) {
                            // Forward flow
                            score = (dx * 80) + (Math.abs(dy) * 15);
                        } 
                        else { 
                            // dx === -1 : Emergency pressure valve for < 10% Right-to-Left connections
                            score = 800 + (Math.abs(dy) * 15); 
                        }
                        
                        // Center gravity to keep graph from drifting diagonally out of frame
                        score += Math.abs(sy) * 2;

                        if (score < bestScore) {
                            bestScore = score;
                            bestSlot = { x: sx, y: sy };
                        }
                    }
                }
                // Break early if a highly optimal, jump-free slot is found
                if (bestSlot && bestScore < (r * 15)) break; 
            }

            if (!bestSlot) bestSlot = { x: baseX, y: Math.round(baseY) };
            
            placed[nodeId] = bestSlot;
            occupied.add(`${bestSlot.x},${bestSlot.y}`);
        });
    });

    // Shift all nodes so X strictly starts at 0 without padding issues
    let minX = 0;
    nodeValues.forEach(n => { 
        if (placed[n.id] && placed[n.id].x < minX) minX = placed[n.id].x; 
    });
    
    // Apply final calculated coordinates
    nodeValues.forEach(n => {
        const coords = placed[n.id] || {x: 0, y: 0};
        n.compactX = (coords.x - minX) * GAP_X;
        n.compactY = coords.y * GAP_Y;
    });
  }
}

// ============================================================================
// 5. EDGE ROUTER
// Determines which face of a node a line should attach to, and spreads them out.
// ============================================================================
class EdgeRouter {
  /**
   * Evaluates relative positions of nodes and updates the connection points.
   */
  static route(state, dir) {
    const { nodes, edges } = state;
    const isLR = (dir === 'LR' || dir === 'FALLING_LR' || dir === 'COMPACT');

    edges.forEach(e => {
      const src = nodes[e.f];
      const tgt = nodes[e.t];
      
      if (!src || !tgt) return;

      // Handle Cycle Back-Edges (Always loop from top to top)
      if (e.isBack) { 
        e._exit = { x: src.x + src.w * 0.38, y: src.y }; 
        e._enter = { x: tgt.x + tgt.w * 0.38, y: tgt.y }; 
        e._exitFace = 'top'; 
        e._enterFace = 'top'; 
        return; 
      }
      
      // Determine optimal connection faces based on relative node positions
      const tcx = tgt.x + tgt.w/2;
      const tcy = tgt.y + tgt.h/2;
      const scx = src.x + src.w/2;
      const scy = src.y + src.h/2;
      
      e._exitFace = this._getFace(src, tcx, tcy, isLR, tgt);
      e._enterFace = this._getFace(tgt, scx, scy, isLR, src);

      // Detect mathematically straight vertical or horizontal connection trunks
      e._isVerticalTrunk = (Math.abs(src.x - tgt.x) < 1) && 
                           (e._exitFace === 'top' || e._exitFace === 'bottom') && 
                           (e._enterFace === 'top' || e._enterFace === 'bottom');

      e._isHorizontalTrunk = (Math.abs(src.y - tgt.y) < 1) && 
                             (e._exitFace === 'left' || e._exitFace === 'right') && 
                             (e._enterFace === 'left' || e._enterFace === 'right');
      
      // Store coordinate weights so multiple lines on the same face can be sorted cleanly
      e._exitSort = (e._exitFace === 'right' || e._exitFace === 'left') ? tgt.y + tgt.h/2 : tgt.x + tgt.w/2;
      e._enterSort = (e._enterFace === 'right' || e._enterFace === 'left') ? src.y + src.h/2 : src.x + src.w/2;
    });

    // Group edges by face and node to spread them evenly
    const eG = {};
    const nG = {};
    
    edges.forEach(e => { 
      if (!nodes[e.f] || !nodes[e.t] || e.isBack) return; 
      (eG[`${e.f}|${e._exitFace}`] ||= []).push(e); 
      (nG[`${e.t}|${e._enterFace}`] ||= []).push(e); 
    });
    
    Object.keys(eG).forEach(k => this._spreadPorts(eG[k], k, true, nodes));
    Object.keys(nG).forEach(k => this._spreadPorts(nG[k], k, false, nodes));
  }
  
  /**
   * Helper: Calculates the relative vector and returns top/bottom/left/right
   */
  static _getFace(node, px, py, fH, other) {
    const dx = px - (node.x + node.w/2);
    const dy = py - (node.y + node.h/2);
    
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fH ? 'right' : 'bottom';
    
    // Evaluate layout-specific overrides
    if (other) {
      if (fH) {
        if (other.x - (node.x + node.w) > -node.w * 0.4) return 'right';
        if (node.x - (other.x + other.w) > -node.w * 0.4) return 'left';
      } else {
        if (other.y - (node.y + node.h) > -node.h * 0.4) return 'bottom';
        if (node.y - (other.y + other.h) > -node.h * 0.4) return 'top';
      }
    }
    
    const hw = node.w/2;
    const hh = node.h/2;
    const tx = Math.abs(dx) > 0.01 ? (fH?hw:hw*0.35) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 0.01 ? (fH?hh*0.35:hh) / Math.abs(dy) : Infinity;
    
    return (tx < ty) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  }

  /**
   * Helper: Evenly spaces out line ports across the length of a designated face.
   */
  static _spreadPorts(grp, key, isExit, nodes) {
    const [nodeId, face] = key.split('|'); 
    const node = nodes[nodeId]; 
    if (!node) return;

    grp.sort((a, b) => isExit ? a._exitSort - b._exitSort : a._enterSort - b._enterSort);
    const n = grp.length;
    
    grp.forEach((e, i) => {
      // Overwrite spread scaling for mathematically straight trunk connections
      let tt = 0.5;
      if (!e._isVerticalTrunk && !e._isHorizontalTrunk && n > 1) {
          tt = 0.12 + (i / (n - 1)) * (1 - 0.24); // Spacing scale
      }

      let pt = { x: node.x, y: node.y };
      
      if (face === 'right') { pt.x += node.w; pt.y += node.h * tt; } 
      else if (face === 'left') { pt.y += node.h * tt; } 
      else if (face === 'top') { pt.x += node.w * tt; } 
      else if (face === 'bottom') { pt.x += node.w * tt; pt.y += node.h; }
      
      if (isExit) e._exit = pt; else e._enter = pt;
    });
  }
}

// ============================================================================
// 6. APP DECORATOR
// Draws purely aesthetic background layers (Grid lines) independent of data.
// ============================================================================
class AppBackgroundRenderer {
  static draw(ctx, cw, ch, viewport, isDark) {
    const sp = Math.max(30, 40 * viewport.s);
    const ox = ((viewport.x % sp) + sp) % sp;
    const oy = ((viewport.y % sp) + sp) % sp;
    
    ctx.save(); 
    // Softened grid color to prevent distracting pinstriping
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(203, 213, 225, 0.4)'; 
    ctx.lineWidth = 1; 
    
    ctx.beginPath();
    for (let x = ox - sp; x < cw; x += sp) { 
        ctx.moveTo(x, 0); 
        ctx.lineTo(x, ch); 
    }
    for (let y = oy - sp; y < ch; y += sp) { 
        ctx.moveTo(0, y); 
        ctx.lineTo(cw, y); 
    }
    ctx.stroke(); 
    ctx.restore();
  }
}

// ============================================================================
// 7. RENDERER
// Contains the HTML5 Canvas drawing instructions for Nodes, Lines, and Arrows.
// ============================================================================
class Renderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId); 
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2); // Handle Retina displays
    this.cachedLineage = { nodeId: null, chain: null }; // CPU OPTIMIZATION: Lineage caching
    this.resize();
  }
  
  resize() {
    const p = this.canvas.parentElement; 
    this.cw = p.clientWidth; 
    this.ch = p.clientHeight;
    
    this.canvas.width = this.cw * this.dpr; 
    this.canvas.height = this.ch * this.dpr;
    
    this.canvas.style.width = this.cw + 'px'; 
    this.canvas.style.height = this.ch + 'px';
    
    this.ctx.scale(this.dpr, this.dpr);
  }
  
  clear() { 
      this.ctx.clearRect(0, 0, this.cw, this.ch); 
  }
  
  // World Space to Screen Space mathematical converter
  _w2s(pt, vp) { 
      return { 
          x: pt.x * vp.s + vp.x, 
          y: pt.y * vp.s + vp.y 
      }; 
  }
  
  // Uses BFS to traverse graph relationships for dynamic flow-highlighting
  _buildLineage(n, edges) {
    const up = new Set();
    const down = new Set();
    
    // Traverse Downstream
    let q = [n.id]; 
    while(q.length) { 
      const id = q.shift(); 
      edges.forEach(e => { 
          if (e.f === id && !down.has(e.t)) { 
              down.add(e.t); 
              q.push(e.t); 
          } 
      }); 
    }
    
    // Traverse Upstream
    q = [n.id]; 
    while(q.length) { 
      const id = q.shift(); 
      edges.forEach(e => { 
          if (e.t === id && !up.has(e.f)) { 
              up.add(e.f); 
              q.push(e.f); 
          } 
      }); 
    }
    
    return { up, down };
  }

  draw(state, viewport, interaction) {
    const { ctx, cw, ch } = this; 
    const { nodes, edges, typeRegistry } = state;
    const { hovNode, pinnedNode, selectedNodes, marquee, dir } = interaction;
    const activeNode = pinnedNode || hovNode;
    
    // CPU OPTIMIZATION: Cache BFS lineage trace instead of recalculating 60 times a sec
    let chain = null;
    if (activeNode) {
        if (this.cachedLineage && this.cachedLineage.nodeId === activeNode.id) {
            chain = this.cachedLineage.chain;
        } else {
            chain = this._buildLineage(activeNode, edges);
            this.cachedLineage = { nodeId: activeNode.id, chain };
        }
    } else {
        this.cachedLineage = { nodeId: null, chain: null };
    }

    // --- DRAW PASS 1: EDGES ---
    edges.forEach(e => {
      const src = nodes[e.f];
      const tgt = nodes[e.t]; 
      
      if (!src || !tgt) return;
      
      let color = Config.BaseColors.LINE;
      let width = Math.max(1, 1.1 * Math.min(viewport.s, 1));
      let alpha = 0.8;
      let hlActive = false;
      
      // Determine line color and transparency based on hover/pin state
      if (chain) {
        const isDown = chain.down.has(e.t) && (chain.down.has(e.f) || e.f === activeNode.id);
        const isUp = chain.up.has(e.f) && (chain.up.has(e.t) || e.t === activeNode.id);
        
        if (pinnedNode ? (isDown || isUp) : (e.f === activeNode.id || e.t === activeNode.id)) { 
            hlActive = true; 
            color = isDown ? Config.BaseColors.DOWNSTREAM : Config.BaseColors.UPSTREAM; 
            width = 2.5; 
            alpha = 1; 
        } else { 
            alpha = 0.15; 
        }
      }
      
      ctx.save(); 
      ctx.globalAlpha = alpha; 
      ctx.strokeStyle = e.isBack && !chain ? Config.BaseColors.CYCLE_LINE : color; 
      ctx.lineWidth = width; 
      
      if (e.isBack) ctx.setLineDash([5, 4]); // Render loopbacks as dashed lines
      
      const sfp = this._w2s(e._exit || {x: src.x + src.w, y: src.y + src.h/2}, viewport);
      const stp = this._w2s(e._enter || {x: tgt.x, y: tgt.y + tgt.h/2}, viewport);
      
      // CPU OPTIMIZATION: Edge Culling
      // Skips mathematically heavy bezier curve rendering if the line is completely off-screen
      const m = 250 * viewport.s; 
      if ((sfp.x < -m && stp.x < -m) || (sfp.x > cw + m && stp.x > cw + m) || 
          (sfp.y < -m && stp.y < -m) || (sfp.y > ch + m && stp.y > ch + m)) {
          ctx.restore();
          return; 
      }

      // 1. Draw Loopback Edges
      if (e.isBack) { 
        const arcY = Math.min(sfp.y, stp.y) - 40 * viewport.s; 
        ctx.beginPath(); 
        ctx.moveTo(sfp.x, sfp.y); 
        ctx.bezierCurveTo(sfp.x, arcY, stp.x, arcY, stp.x, stp.y); 
        ctx.stroke();
      }
      // 2. Draw Standard Flow Edges
      else {
        const isLRMode = dir === 'LR' || dir === 'FALLING_LR' || dir === 'COMPACT';
        const flowDist = isLRMode ? Math.abs(stp.x - sfp.x) : Math.abs(stp.y - sfp.y);
        
        // Tighter bezier curves calculation so overlapping lines don't bleed into space
        const sbend = Math.min(Math.max(Math.hypot(stp.x - sfp.x, stp.y - sfp.y) * 0.1, 15), Math.max(flowDist * 0.45, 20));
        const wbend = sbend / viewport.s;

        const ft = this._getFaceTangent(src, e._exit);
        const tt = this._getFaceTangent(tgt, e._enter);
        
        const sc1 = this._w2s({x: e._exit.x + ft.x * wbend, y: e._exit.y + ft.y * wbend}, viewport);
        const sc2 = this._w2s({x: e._enter.x + tt.x * wbend, y: e._enter.y + tt.y * wbend}, viewport);
        
        // Calculate true tangent angle based on the curve control point for perfect arrowhead rotation
        const ang = Math.hypot(stp.x - sc2.x, stp.y - sc2.y) < 0.5 ? Math.atan2(stp.y - sfp.y, stp.x - sfp.x) : Math.atan2(stp.y - sc2.y, stp.x - sc2.x);
        const aw = chain && hlActive ? 7.5 : Math.max(5, 5.5 * Math.min(viewport.s, 1.3));
        
        // Pull line stroke back slightly so it doesn't visibly poke through the arrowhead tip
        const sx = stp.x - Math.cos(ang) * aw * 1.5;
        const sy = stp.y - Math.sin(ang) * aw * 1.5;

        ctx.beginPath(); 
        ctx.moveTo(sfp.x, sfp.y); 
        ctx.bezierCurveTo(sc1.x, sc1.y, sc2.x, sc2.y, sx, sy);
        ctx.stroke();

        // 3. Draw Arrowheads
        if (viewport.s > 0.08) {
          ctx.fillStyle = ctx.strokeStyle; 
          ctx.translate(stp.x, stp.y); 
          ctx.rotate(ang);
          ctx.beginPath(); 
          ctx.moveTo(0, 0); 
          ctx.lineTo(-aw*1.9, -aw*0.62); 
          ctx.lineTo(-aw*1.9, aw*0.62); 
          ctx.fill();
        }
      }
      ctx.restore();
    });

    // --- DRAW PASS 2: NODES ---
    Object.values(nodes).forEach(n => {
      const s = this._w2s(n, viewport);
      const sw = n.w * viewport.s;
      const sh = n.h * viewport.s;
      
      // Culling: Do not draw nodes that are completely out of bounds
      if (s.x + sw < 0 || s.x > cw || s.y + sh < 0 || s.y > ch) return;
      
      const nType = n.type || 'UNKNOWN';
      const c = typeRegistry.colors[nType] || Config.BaseColors.DEFAULT;
      
      let isSel = selectedNodes.has(n);
      let alpha = chain ? (chain.up.has(n.id) || chain.down.has(n.id) || n.id === activeNode.id ? 1 : 0.35) : 1;
      let glow = isSel ? '#3b82f6' : (n.self ? Config.BaseColors.HIGHLIGHT : (activeNode === n ? c : null));
      
      const r = Config.Node.RADIUS * viewport.s;
      
      ctx.save(); 
      ctx.globalAlpha = alpha; 
      
      // 1. Draw Drop Shadow
      if (glow) { 
          ctx.shadowBlur = 15; 
          ctx.shadowColor = glow + '66'; 
      }
      
      // 2. Draw Node Background
      ctx.fillStyle = Config.BaseColors.CARD_BG; 
      this._roundRect(s.x, s.y, sw, sh, r); 
      ctx.fill();
      
      // 3. Draw Node Stroke
      ctx.strokeStyle = glow ? glow : Config.BaseColors.BORDER; 
      ctx.lineWidth = (isSel ? 3 : n.self || pinnedNode === n ? 2.5 : hovNode === n ? 2 : 0.8) * Math.min(viewport.s, 1);
      this._roundRect(s.x, s.y, sw, sh, r); 
      ctx.stroke();
      
      // 4. Draw Type/Color Indicator Bar (Left Edge)
      ctx.shadowBlur = 0; 
      const st = 5 * viewport.s; 
      ctx.fillStyle = n.self ? Config.BaseColors.HIGHLIGHT : c;
      ctx.beginPath(); 
      ctx.moveTo(s.x, s.y + r); 
      ctx.quadraticCurveTo(s.x, s.y, s.x + r, s.y); 
      ctx.lineTo(s.x + st, s.y); 
      ctx.lineTo(s.x + st, s.y + sh); 
      ctx.lineTo(s.x + r, s.y + sh); 
      ctx.quadraticCurveTo(s.x, s.y + sh, s.x, s.y + sh - r); 
      ctx.fill();
      
      // 5. Draw Node Typography (Optimized to hide text when zoomed too far out)
      if (viewport.s > 0.25) {
        // Draw Node Type Label (Top Right)
        ctx.font = `700 ${Math.max(7, 8 * viewport.s)}px sans-serif`; 
        ctx.fillStyle = c + 'cc'; 
        ctx.textAlign = 'right'; 
        ctx.textBaseline = 'top';
        ctx.fillText(typeRegistry.labels[nType] || 'UNK', s.x + sw - 6 * viewport.s, s.y + 4 * viewport.s);
        
        // Draw Schema Label (Top Left)
        if (viewport.s > 0.45 && n.schema) { 
            ctx.font = `400 ${Math.max(6, 8 * viewport.s)}px monospace`; 
            ctx.fillStyle = Config.BaseColors.TEXT_MUTED; 
            ctx.textAlign = 'left'; 
            ctx.fillText(n.schema, s.x + 10 * viewport.s, s.y + 4 * viewport.s); 
        }
        
        // Draw Main Node Name (Center Left)
        ctx.font = `${n.self ? 700 : 500} ${Math.max(8, 11 * viewport.s)}px monospace`; 
        ctx.fillStyle = hovNode === n ? c : (n.self ? Config.BaseColors.TEXT_SELF : Config.BaseColors.TEXT_MAIN); 
        ctx.textAlign = 'left'; 
        ctx.textBaseline = 'middle';
        
        // Ellipsis truncation for long names
        let lbl = n.name;
        let maxW = sw * 0.85 - 14 * viewport.s; 
        while (lbl.length > 4 && ctx.measureText(lbl).width > maxW) {
            lbl = lbl.slice(0, -1);
        }
        ctx.fillText(lbl + (lbl !== n.name ? '…' : ''), s.x + 10 * viewport.s, s.y + sh * 0.65);
      }
      ctx.restore();
    });

    // --- DRAW PASS 3: MARQUEE SELECTION BOX ---
    if (marquee) {
      ctx.save(); 
      const sx = marquee.sx * viewport.s + viewport.x;
      const sy = marquee.sy * viewport.s + viewport.y;
      const cx = marquee.cx * viewport.s + viewport.x;
      const cy = marquee.cy * viewport.s + viewport.y;
      
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)'; 
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)'; 
      
      ctx.fillRect(sx, sy, cx - sx, cy - sy); 
      ctx.strokeRect(sx, sy, cx - sx, cy - sy); 
      ctx.restore();
    }
  }

  // Mathematics: Canvas smooth rounded rectangle generator
  _roundRect(x, y, w, h, r) { 
      this.ctx.beginPath(); 
      this.ctx.moveTo(x + r, y); 
      this.ctx.lineTo(x + w - r, y); 
      this.ctx.quadraticCurveTo(x + w, y, x + w, y + r); 
      this.ctx.lineTo(x + w, y + h - r); 
      this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); 
      this.ctx.lineTo(x + r, y + h); 
      this.ctx.quadraticCurveTo(x, y + h, x, y + h - r); 
      this.ctx.lineTo(x, y + r); 
      this.ctx.quadraticCurveTo(x, y, x + r, y); 
      this.ctx.closePath(); 
  }
  
  // Mathematics: Normalizes the vector coordinate for edge control-point geometry
  _getFaceTangent(node, pt) {
    if (!pt) return {x: 1, y: 0};
    
    if (Math.abs(pt.x - node.x) < 1.5) return {x: -1, y: 0}; 
    if (Math.abs(pt.x - (node.x + node.w)) < 1.5) return {x: 1, y: 0}; 
    if (Math.abs(pt.y - node.y) < 1.5) return {x: 0, y: -1}; 
    if (Math.abs(pt.y - (node.y + node.h)) < 1.5) return {x: 0, y: 1};
    
    const dx = pt.x - (node.x + node.w/2);
    const dy = pt.y - (node.y + node.h/2);
    const d = Math.hypot(dx, dy) || 1; 
    
    return {x: dx/d, y: dy/d};
  }
}

// ============================================================================
// 8. ORCHESTRATOR & INTERACTION
// The brain of the App. Manages memory state, triggers updates, and binds 
// the massive event listeners required for panning, zooming, and dragging.
// ============================================================================
class LineageApp {
  constructor(inputData) {
    this.viewport = { x: 0, y: 0, s: 1 }; 
    this.interaction = { 
        dir: null, hovNode: null, dragData: null, pinnedNode: null, 
        pan: { a: false }, selectedNodes: new Set(), marquee: null, toolMode: 'pan'
    };
    this.renderer = new Renderer('cv'); 
    this.isDark = false;
    this.bindEvents(); 
    this.loadData(inputData, 'LR'); 
  }

  // --- TOOLTIP LOGIC ---
  ensureTip() {
    if(this._tipEl) return this._tipEl;
    this._tipEl = document.createElement('div');
    this._tipEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none;background:#1e293b;color:#f1f5f9;font-size:12px;font-family:Consolas,monospace;padding:5px 10px;border-radius:5px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.08);transition:opacity .1s';
    document.body.appendChild(this._tipEl);
    return this._tipEl;
  }

  showTip(node, clientX, clientY) {
    const tip = this.ensureTip();
    const fullName = node.schema ? node.schema + '.' + node.name : node.name;
    tip.textContent = fullName;
    tip.style.display = 'block';
    tip.style.opacity = '1';
    this.positionTip(clientX, clientY);
  }

  positionTip(clientX, clientY) {
    const tip = this.ensureTip();
    const ox = 14;
    const oy = -36;
    let x = clientX + ox;
    let y = clientY + oy;
    
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    
    // Bounds checking to keep tooltip on screen
    if(x + tw > window.innerWidth - 8) x = clientX - tw - ox;
    if(y < 8) y = clientY + 16;
    
    tip.style.left = x + 'px'; 
    tip.style.top = y + 'px';
  }

  hideTip() {
    if(this._tipEl) { 
        this._tipEl.style.display = 'none'; 
    }
  }

  // --- DYNAMIC LEGEND ---
  buildTypeRegistry(nodes) {
    this.typeRegistry = { colors: {}, labels: {} };
    let colorIdx = 0;
    
    // First, map known defaults so they keep their familiar colors if present
    const standardMapping = {
      'TABLE': { c: '#3b82f6', l: 'TBL' },
      'VIEW': { c: '#10b981', l: 'VW' },
      'MATERIALIZED VIEW': { c: '#8b5cf6', l: 'MV' },
      'PROCEDURE': { c: '#f59e0b', l: 'SP' }
    };

    Object.values(nodes).forEach(n => {
      const t = n.type || 'UNKNOWN';
      if (!this.typeRegistry.colors[t]) {
        if (standardMapping[t]) {
          this.typeRegistry.colors[t] = standardMapping[t].c;
          this.typeRegistry.labels[t] = standardMapping[t].l;
        } else {
          // Dynamically assign color from palette
          this.typeRegistry.colors[t] = Config.Palette[colorIdx % Config.Palette.length];
          colorIdx++;
          // Dynamically generate shorthand (e.g., "KAFKA TOPIC" -> "KT", "SNOWFLAKE" -> "SNO")
          const words = t.split(/[\s_-]+/);
          this.typeRegistry.labels[t] = words.length > 1 
            ? words.map(w => w[0]).join('').substring(0, 3).toUpperCase()
            : t.substring(0, 3).toUpperCase();
        }
      }
    });

    // Dynamically update the HTML footer legend
    const legendContainer = document.getElementById('legend-dynamic');
    legendContainer.innerHTML = '';
    Object.keys(this.typeRegistry.colors).forEach(t => {
      const color = this.typeRegistry.colors[t];
      legendContainer.innerHTML += `<div class="li"><div class="lb" style="background:${color}"></div>${t.toUpperCase()}</div>`;
    });
  }

  // --- DATA LOADING ---
  loadData(inputData, forceDir = null) {
    // 1. Parse JSON to internal state
    this.state = DataParser.parse(inputData); 
    this.interaction.hovNode = null; 
    this.interaction.selectedNodes.clear();
    
    // 2. Assign dynamic colors based on node types
    this.buildTypeRegistry(this.state.nodes);
    this.state.typeRegistry = this.typeRegistry; 

    // 3. Run all heavy math calculations
    LayoutEngine.apply(this.state); 
    
    // 4. Update UI Headers
    const selfNode = Object.values(this.state.nodes).find(n => n.self);
    if (selfNode) {
      document.title = document.getElementById('page-title').textContent = `${selfNode.schema ? selfNode.schema + '.' : ''}${selfNode.name} — ab.js`;
    } else {
      document.title = document.getElementById('page-title').textContent = `ab.js`;
    }
    
    const nodeCount = Object.keys(this.state.nodes).length;
    document.getElementById('btn-export-png').disabled = nodeCount === 0;
    document.getElementById('stats-counter').textContent = `${nodeCount} nodes · ${this.state.edges.length} edges`;
    
    // 5. Apply the default or requested layout format
    const targetDir = forceDir || this.interaction.dir || 'LR'; 
    this.interaction.dir = null; 
    this.setDirection(targetDir);
  }

  scheduleRender() { 
      // RequestAnimationFrame ensures we don't draw faster than the monitor's refresh rate (60hz)
      if (!this.rafId) {
          this.rafId = requestAnimationFrame(() => { 
              this.rafId = null; 
              this.renderer.clear(); 
              AppBackgroundRenderer.draw(this.renderer.ctx, this.renderer.cw, this.renderer.ch, this.viewport, this.isDark); 
              this.renderer.draw(this.state, this.viewport, this.interaction); 
          }); 
      }
  }
  
  // --- EXPORT ---
  exportPNG() {
    const nodes = Object.values(this.state.nodes); 
    if (!nodes.length) return;
    
    const pad = 100;
    const x0 = Math.min(...nodes.map(n => n.x)) - pad;
    const y0 = Math.min(...nodes.map(n => n.y)) - pad;
    const x1 = Math.max(...nodes.map(n => n.x + n.w)) + pad;
    const y1 = Math.max(...nodes.map(n => n.y + n.h)) + pad;
    
    const ew = x1 - x0;
    const eh = y1 - y0;
    
    const canvas = document.createElement('canvas'); 
    const dpr = 2; 
    canvas.width = ew * dpr; 
    canvas.height = eh * dpr;
    
    const ctx = canvas.getContext('2d'); 
    ctx.scale(dpr, dpr); 
    ctx.fillStyle = this.isDark ? '#0f172a' : '#f8fafc'; 
    ctx.fillRect(0, 0, ew, eh);
    
    const v = { x: -x0, y: -y0, s: 1 }; 
    AppBackgroundRenderer.draw(ctx, ew, eh, v, this.isDark);
    
    const exportCanvasRenderer = Object.assign(Object.create(Object.getPrototypeOf(this.renderer)), this.renderer); 
    exportCanvasRenderer.ctx = ctx; 
    exportCanvasRenderer.cw = ew; 
    exportCanvasRenderer.ch = eh;
    
    // Pass the entire interaction state (except temporary hover/drag) to capture the pinned highlights
    exportCanvasRenderer.draw(this.state, v, { 
        dir: this.interaction.dir, 
        selectedNodes: this.interaction.selectedNodes, 
        pinnedNode: this.interaction.pinnedNode, 
        hovNode: null, 
        marquee: null 
    });
    
    const link = document.createElement('a'); 
    let safeTitle = document.getElementById('page-title').textContent.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = (safeTitle || 'ab_export') + '.png'; 
    link.href = canvas.toDataURL(); 
    link.click();
  }

  // Mathematics: Convert Screen coordinates (mouse position) to World Space coordinates
  s2w(mx, my) { 
      return { 
          x: (mx - this.viewport.x) / this.viewport.s, 
          y: (my - this.viewport.y) / this.viewport.s 
      }; 
  }
  
  // Scans all nodes to check if a mouse coordinate is currently hovering over one
  hitNode(wx, wy) { 
      const nodes = Object.values(this.state.nodes); 
      // Loop backwards to hit top-layer nodes first
      for (let i = nodes.length - 1; i >= 0; i--) { 
          const n = nodes[i]; 
          if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n; 
      } 
      return null; 
  }
  
  doZoom(f, mx = this.renderer.cw / 2, my = this.renderer.ch / 2) { 
      const wPt = this.s2w(mx, my); 
      this.viewport.s = Math.max(0.07, Math.min(4, this.viewport.s * f)); 
      this.viewport.x = mx - wPt.x * this.viewport.s; 
      this.viewport.y = my - wPt.y * this.viewport.s; 
      document.getElementById('zoom-pct').textContent = Math.round(this.viewport.s * 100) + '%'; 
      this.scheduleRender(); 
  }
  
  resetLayout() {
    if (!this.state || !this.state.nodes) return;
    
    Object.values(this.state.nodes).forEach(n => {
      if (this.interaction.dir === 'LR') {
        n.x = n.defaultLrX; n.y = n.defaultLrY;
        n.lrX = n.defaultLrX; n.lrY = n.defaultLrY;
      } else if (this.interaction.dir === 'TB') {
        n.x = n.defaultTbX; n.y = n.defaultTbY;
        n.tbX = n.defaultTbX; n.tbY = n.defaultTbY;
      } else if (this.interaction.dir === 'FALLING_LR') {
        n.x = n.defaultFallingLrX; n.y = n.defaultFallingLrY;
        n.fallingLrX = n.defaultFallingLrX; n.fallingLrY = n.defaultFallingLrY;
      } else if (this.interaction.dir === 'COMPACT') {
        n.x = n.defaultCompactX; n.y = n.defaultCompactY;
        n.compactX = n.defaultCompactX; n.compactY = n.defaultCompactY;
      }
    });
    
    EdgeRouter.route(this.state, this.interaction.dir);
    this.fitView();
  }
  
  fitView() {
    const nodes = Object.values(this.state.nodes); 
    if (!nodes.length) {
      this.scheduleRender(); // Force canvas clear if empty
      return; 
    }
    
    const x0 = Math.min(...nodes.map(n => n.x)) - 30;
    const y0 = Math.min(...nodes.map(n => n.y)) - 30;
    const x1 = Math.max(...nodes.map(n => n.x + n.w)) + 30;
    const y1 = Math.max(...nodes.map(n => n.y + n.h)) + 30;
    
    this.viewport.s = Math.min(this.renderer.cw / (x1 - x0), this.renderer.ch / (y1 - y0)) * 0.94; 
    this.viewport.x = this.renderer.cw/2 - ((x0+x1)/2) * this.viewport.s; 
    this.viewport.y = this.renderer.ch/2 - ((y0+y1)/2) * this.viewport.s;
    
    document.getElementById('zoom-pct').textContent = Math.round(this.viewport.s * 100) + '%'; 
    this.scheduleRender();
  }

  setDirection(newDir) {
    if (this.interaction.dir === newDir) return; 
    
    // Save current user-dragged positions to memory state before switching
    if (this.interaction.dir) {
        Object.values(this.state.nodes).forEach(n => { 
            if (this.interaction.dir === 'LR') { n.lrX = n.x; n.lrY = n.y; } 
            else if (this.interaction.dir === 'TB') { n.tbX = n.x; n.tbY = n.y; } 
            else if (this.interaction.dir === 'FALLING_LR') { n.fallingLrX = n.x; n.fallingLrY = n.y; }
            else if (this.interaction.dir === 'COMPACT') { n.compactX = n.x; n.compactY = n.y; }
        });
    }
    
    this.interaction.dir = newDir; 
    
    // Reload mapped position for new layout direction
    Object.values(this.state.nodes).forEach(n => { 
        if (newDir === 'LR') { 
            n.x = n.lrX; n.y = n.lrY; 
            n.w = Config.Node.LR_W; n.h = Config.Node.LR_H; 
        } 
        else if (newDir === 'TB') { 
            n.x = n.tbX; n.y = n.tbY; 
            n.w = Config.Node.TB_W; n.h = Config.Node.TB_H; 
        } 
        else if (newDir === 'FALLING_LR') { 
            n.x = n.fallingLrX; n.y = n.fallingLrY; 
            n.w = Config.Node.LR_W; n.h = Config.Node.LR_H; 
        }
        else if (newDir === 'COMPACT') { 
            n.x = n.compactX; n.y = n.compactY; 
            n.w = Config.Node.LR_W; n.h = Config.Node.LR_H; 
        }
    });
    
    document.getElementById('layout-select').value = newDir; 
    EdgeRouter.route(this.state, newDir); 
    this.fitView();
  }

  // --- EVENT LISTENERS ---
  bindEvents() {
    const wrap = document.getElementById('canvas-wrap');
    
    // Toolbar Triggers
    document.getElementById('layout-select').addEventListener('change', (e) => this.setDirection(e.target.value));
    
    document.getElementById('btn-zoom-in').onclick = () => this.doZoom(1.15); 
    document.getElementById('btn-zoom-out').onclick = () => this.doZoom(0.87);
    
    document.getElementById('btn-reset').onclick = () => this.resetLayout();
    document.getElementById('btn-fit').onclick = () => this.fitView(); 
    document.getElementById('btn-export-png').onclick = () => this.exportPNG();
    
    window.addEventListener('resize', () => { 
        this.renderer.resize(); 
        this.scheduleRender(); 
    });
    
    // Theme toggle logic
    const moonIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    const sunIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const themeBtn = document.getElementById('btn-theme-toggle');
    
    themeBtn.onclick = () => {
      this.isDark = !this.isDark;
      document.body.classList.toggle('dark', this.isDark);
      themeBtn.innerHTML = this.isDark ? sunIcon : moonIcon;
      Config.BaseColors = this.isDark ? Config.DarkColors : Config.LightColors;
      this.scheduleRender();
    };

    // Mode Toggle (Pan vs Select)
    const panIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path></svg>';
    const selectIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke-dasharray="5 5"></rect></svg>';
    const mBtn = document.getElementById('btn-mode-toggle'); 
    
    mBtn.onclick = () => { 
      const isPan = this.interaction.toolMode === 'pan'; 
      this.interaction.toolMode = isPan ? 'select' : 'pan'; 
      mBtn.innerHTML = isPan ? selectIcon : panIcon; 
      mBtn.classList.toggle('active', !isPan); 
      wrap.style.cursor = isPan ? 'default' : 'grab'; 
    };

    // JSON Loading Triggers
    document.getElementById('btn-load-json').onclick = () => { 
        document.getElementById('json-input').value = JSON.stringify(RAW_INPUT, null, 2); 
        document.getElementById('json-modal').style.display = 'flex'; 
    };
    
    document.getElementById('btn-cancel-json').onclick = () => {
        document.getElementById('json-modal').style.display = 'none';
    };
    
    document.getElementById('btn-render-json').onclick = () => { 
        try { 
            this.loadData(JSON.parse(document.getElementById('json-input').value)); 
            document.getElementById('json-modal').style.display = 'none'; 
        } catch (e) { 
            document.getElementById('json-error').textContent = e.message; 
            document.getElementById('json-error').style.display = 'block'; 
        } 
    };
    
    // --- Canvas Mouse Listeners ---
    let isD = false; 
    wrap.addEventListener('contextmenu', e => e.preventDefault());
    
    wrap.addEventListener('mousedown', e => {
      this.hideTip();
      isD = false; 
      
      const r = wrap.getBoundingClientRect();
      const wPt = this.s2w(e.clientX - r.left, e.clientY - r.top);
      const hit = this.hitNode(wPt.x, wPt.y);
      
      // Pan initialization (Right-click or Left-click in empty space during 'pan' mode)
      if (e.button === 2 || (e.button === 0 && !hit && this.interaction.toolMode === 'pan')) { 
          this.interaction.pan = { a: true, sx: e.clientX, sy: e.clientY, ox: this.viewport.x, oy: this.viewport.y }; 
          wrap.style.cursor = 'grabbing'; 
          return; 
      }
      if (e.button !== 0) return;

      // Box Select Initiation
      if (!hit && this.interaction.toolMode === 'select') {
          this.interaction.selectedNodes.clear(); 
          this.interaction.marquee = { sx: wPt.x, sy: wPt.y, cx: wPt.x, cy: wPt.y, base: new Set() }; 
      }
      // Group Drag Selection Initiation
      else if (hit) { 
          if (!e.shiftKey && !this.interaction.selectedNodes.has(hit)) {
              this.interaction.selectedNodes.clear(); 
          }
          this.interaction.selectedNodes.add(hit); 
          
          const initialPos = new Map(); 
          this.interaction.selectedNodes.forEach(n => initialPos.set(n, { x: n.x, y: n.y })); 
          this.interaction.dragData = { startX: wPt.x, startY: wPt.y, initialPos }; 
          wrap.style.cursor = 'grabbing'; 
      }
      
      this.scheduleRender();
    });

    wrap.addEventListener('mousemove', e => {
      const r = wrap.getBoundingClientRect();
      const wPt = this.s2w(e.clientX - r.left, e.clientY - r.top);
      
      if (this.interaction.dragData || this.interaction.pan.a || this.interaction.marquee) {
          isD = true;
      }
      
      let needsRender = false;

      // Evaluate Node Dragging
      if (this.interaction.dragData) { 
          const dx = wPt.x - this.interaction.dragData.startX;
          const dy = wPt.y - this.interaction.dragData.startY; 
          
          this.interaction.selectedNodes.forEach(n => { 
              const i = this.interaction.dragData.initialPos.get(n); 
              n.x = i.x + dx; 
              n.y = i.y + dy; 
          }); 
          
          EdgeRouter.route(this.state, this.interaction.dir); 
          needsRender = true; 
      }
      // Evaluate Marquee Selection Box
      else if (this.interaction.marquee) { 
          this.interaction.marquee.cx = wPt.x; 
          this.interaction.marquee.cy = wPt.y; 
          
          const x = Math.min(this.interaction.marquee.sx, wPt.x);
          const y = Math.min(this.interaction.marquee.sy, wPt.y);
          const w = Math.abs(this.interaction.marquee.sx - wPt.x);
          const h = Math.abs(this.interaction.marquee.sy - wPt.y); 
          
          this.interaction.selectedNodes.clear(); 
          Object.values(this.state.nodes).forEach(n => { 
              if (n.x < x + w && n.x + n.w > x && n.y < y + h && n.y + n.h > y) {
                  this.interaction.selectedNodes.add(n); 
              }
          }); 
          needsRender = true; 
      }
      // Evaluate Panning
      else if (this.interaction.pan.a) { 
          this.viewport.x = this.interaction.pan.ox + (e.clientX - this.interaction.pan.sx); 
          this.viewport.y = this.interaction.pan.oy + (e.clientY - this.interaction.pan.sy); 
          needsRender = true; 
      }

      // Normal Hover and Hit Detection
      const hit = this.hitNode(wPt.x, wPt.y); 
      if (this.interaction.hovNode !== hit) {
          this.interaction.hovNode = hit;
          needsRender = true;
      }

      wrap.style.cursor = hit ? 'pointer' : (this.interaction.toolMode === 'pan' ? 'grab' : 'default'); 
      
      if (hit && !this.interaction.dragData && !this.interaction.pan.a && !this.interaction.marquee) {
        this.showTip(hit, e.clientX, e.clientY);
      } else {
        this.hideTip();
      }
      
      // CPU OPTIMIZATION: Only redraw the massive canvas if state actually changed!
      if (needsRender) this.scheduleRender();
    });
    
    wrap.addEventListener('mouseleave', () => { 
        this.hideTip(); 
    });
    
    // Safety Reset Mouse Interactions
    wrap.addEventListener('mouseup', e => {
      if (!isD && e.button === 0) { 
          const r = wrap.getBoundingClientRect();
          const wPt = this.s2w(e.clientX - r.left, e.clientY - r.top);
          const hit = this.hitNode(wPt.x, wPt.y);
          
          if (hit) {
              // Toggle pin state
              this.interaction.pinnedNode = this.interaction.pinnedNode === hit ? null : hit; 
          } else { 
              // Clear selection on empty click
              this.interaction.pinnedNode = null; 
              this.interaction.selectedNodes.clear(); 
          }
      }
      
      this.interaction.dragData = null; 
      this.interaction.marquee = null; 
      this.interaction.pan.a = false; 
      this.scheduleRender();
    });

    wrap.addEventListener('wheel', e => { 
        e.preventDefault(); 
        const r = wrap.getBoundingClientRect();
        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        this.doZoom(zoomFactor, e.clientX - r.left, e.clientY - r.top); 
    }, { passive: false });
  }
}

// Initialize Application
window.onload = () => { 
    window.LineageApplication = new LineageApp(RAW_INPUT); 
};