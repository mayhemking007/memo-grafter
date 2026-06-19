export interface StudioFrontendState {
  databaseStatus: "connected" | "error";
  sessionCount: number;
  studioUrl: string;
  message?: string;
}

export function renderStudioHtml(state: StudioFrontendState): string {
  const serializedState = JSON.stringify(state).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MemoGrafter Studio</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f8fb;
        color: #17202d;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
      }

      button,
      input,
      select {
        font: inherit;
      }

      button {
        cursor: pointer;
      }

      .app-shell {
        display: grid;
        grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
        min-height: 100vh;
      }

      .sidebar {
        background: #ffffff;
        border-right: 1px solid #d8dee9;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }

      .sidebar-header {
        border-bottom: 1px solid #e4e8f0;
        padding: 20px;
      }

      .brand-row {
        align-items: center;
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .brand {
        font-size: 18px;
        font-weight: 750;
        margin: 0;
      }

      .status-pill {
        align-items: center;
        border: 1px solid #b9d8c8;
        border-radius: 999px;
        color: #16714a;
        display: inline-flex;
        font-size: 12px;
        font-weight: 650;
        gap: 7px;
        padding: 5px 9px;
        white-space: nowrap;
      }

      .status-dot {
        background: #18a66c;
        border-radius: 999px;
        height: 8px;
        width: 8px;
      }

      .studio-url {
        color: #617086;
        font-size: 12px;
        margin: 10px 0 0;
        overflow-wrap: anywhere;
      }

      .session-toolbar,
      .graph-toolbar {
        align-items: center;
        display: flex;
        gap: 10px;
        justify-content: space-between;
      }

      .session-toolbar {
        padding: 16px 20px 10px;
      }

      .section-title {
        font-size: 13px;
        font-weight: 750;
        margin: 0;
        text-transform: uppercase;
      }

      .icon-button,
      .primary-button {
        align-items: center;
        border: 1px solid #c9d2e2;
        border-radius: 7px;
        background: #ffffff;
        color: #253246;
        display: inline-flex;
        font-weight: 650;
        gap: 7px;
        min-height: 34px;
        padding: 7px 10px;
      }

      .icon-button:hover,
      .primary-button:hover {
        border-color: #8fa4c4;
        background: #f8fbff;
      }

      .icon {
        display: inline-block;
        line-height: 1;
        width: 16px;
      }

      .session-list {
        display: grid;
        gap: 8px;
        list-style: none;
        margin: 0;
        overflow: auto;
        padding: 0 12px 20px;
      }

      .session-button {
        background: #ffffff;
        border: 1px solid #e0e5ee;
        border-radius: 8px;
        color: inherit;
        display: grid;
        gap: 8px;
        padding: 12px;
        text-align: left;
        width: 100%;
      }

      .session-button[aria-current="true"] {
        border-color: #3d6fb6;
        box-shadow: inset 3px 0 0 #3d6fb6;
      }

      .session-id {
        font-size: 13px;
        font-weight: 750;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .session-meta {
        color: #607086;
        display: flex;
        flex-wrap: wrap;
        font-size: 12px;
        gap: 7px;
      }

      .badge {
        background: #eef3fa;
        border: 1px solid #dbe3ef;
        border-radius: 999px;
        color: #45556b;
        display: inline-flex;
        font-size: 12px;
        font-weight: 650;
        padding: 3px 7px;
      }

      .main {
        min-width: 0;
        padding: 22px;
      }

      .topbar {
        align-items: flex-start;
        display: flex;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 18px;
      }

      h1 {
        font-size: 23px;
        line-height: 1.2;
        margin: 0 0 6px;
      }

      .subtle {
        color: #66758a;
        font-size: 13px;
        line-height: 1.45;
        margin: 0;
      }

      .filters {
        align-items: end;
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(3, minmax(130px, 1fr)) auto;
        margin-bottom: 16px;
      }

      .field {
        display: grid;
        gap: 5px;
      }

      .field label {
        color: #58687e;
        font-size: 12px;
        font-weight: 700;
      }

      .field input,
      .field select {
        background: #ffffff;
        border: 1px solid #cfd7e6;
        border-radius: 7px;
        color: #1c2737;
        min-height: 36px;
        padding: 7px 9px;
        width: 100%;
      }

      .content-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1fr) 300px;
      }

      .panel {
        background: #ffffff;
        border: 1px solid #d8dee9;
        border-radius: 8px;
        min-width: 0;
      }

      .graph-panel {
        min-height: 560px;
        overflow: hidden;
      }

      .panel-header {
        align-items: center;
        border-bottom: 1px solid #e4e8f0;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        min-height: 50px;
        padding: 12px 14px;
      }

      .panel-title {
        font-size: 14px;
        font-weight: 750;
        margin: 0;
      }

      .graph-stage {
        min-height: 508px;
        overflow: auto;
      }

      .empty-state,
      .error-state,
      .loading-state {
        color: #66758a;
        display: grid;
        min-height: 508px;
        place-items: center;
        text-align: center;
      }

      .error-state {
        color: #9a3412;
      }

      .graph-svg {
        display: block;
        min-width: 760px;
      }

      .node-card rect {
        fill: #ffffff;
        stroke: #cad3e2;
        stroke-width: 1.5;
      }

      .node-card.topic rect {
        fill: #eef6ff;
        stroke: #78a6d8;
      }

      .node-card.memory rect {
        fill: #f4f2ff;
        stroke: #9f91d9;
      }

      .node-card.selected rect {
        stroke: #1d4ed8;
        stroke-width: 2.5;
      }

      .node-card text {
        fill: #1f2a3a;
        font-size: 12px;
        pointer-events: none;
      }

      .node-card .node-kind {
        fill: #617086;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .edge-line {
        stroke: #98a6ba;
        stroke-width: 1.5;
      }

      .edge-line.memory {
        stroke: #a693cf;
        stroke-dasharray: 4 4;
      }

      .details {
        display: grid;
        gap: 12px;
        padding: 14px;
      }

      .detail-row {
        display: grid;
        gap: 4px;
      }

      .detail-label {
        color: #627188;
        font-size: 11px;
        font-weight: 750;
        text-transform: uppercase;
      }

      .detail-value {
        color: #1f2a3a;
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .tag-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .summary-strip {
        color: #617086;
        display: flex;
        flex-wrap: wrap;
        font-size: 12px;
        gap: 8px;
      }

      .hidden {
        display: none;
      }

      @media (max-width: 980px) {
        .app-shell,
        .content-grid {
          grid-template-columns: 1fr;
        }

        .sidebar {
          min-height: auto;
        }

        .filters {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 640px) {
        .filters,
        .topbar {
          grid-template-columns: 1fr;
          display: grid;
        }

        .main {
          padding: 14px;
        }
      }
    </style>
  </head>
  <body>
    <div class="app-shell" id="studio-app">
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="brand-row">
            <p class="brand">MemoGrafter Studio</p>
            <span class="status-pill"><span class="status-dot"></span><span id="database-status"></span></span>
          </div>
          <p class="studio-url" id="studio-url"></p>
        </div>
        <div class="session-toolbar">
          <p class="section-title">Sessions</p>
          <button class="icon-button" id="refresh-sessions" type="button" title="Refresh sessions"><span class="icon">R</span>Refresh</button>
        </div>
        <ul class="session-list" id="session-list" aria-label="Sessions"></ul>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <h1 id="page-title">Select a session</h1>
            <p class="subtle" id="page-subtitle">Graph data loads only after you choose a session.</p>
          </div>
          <button class="primary-button" id="refresh-graph" type="button" disabled><span class="icon">R</span>Refresh graph</button>
        </div>

        <div class="filters" aria-label="Graph filters">
          <div class="field">
            <label for="node-type-filter">Node type</label>
            <select id="node-type-filter">
              <option value="all">All nodes</option>
              <option value="topics">Topics</option>
              <option value="memories">Memories</option>
            </select>
          </div>
          <div class="field">
            <label for="tag-filter">Tags</label>
            <input id="tag-filter" type="search" placeholder="project:memo-grafter">
          </div>
          <div class="field">
            <label for="lifecycle-filter">Lifecycle</label>
            <select id="lifecycle-filter">
              <option value="all">All states</option>
              <option value="active">Active</option>
              <option value="suppressed">Suppressed topics</option>
              <option value="forgotten">Forgotten memories</option>
              <option value="decayed">Decayed memories</option>
              <option value="superseded">Superseded memories</option>
              <option value="conflicting">Conflicting memories</option>
            </select>
          </div>
          <button class="icon-button" id="clear-filters" type="button"><span class="icon">X</span>Clear</button>
        </div>

        <div class="content-grid">
          <section class="panel graph-panel" aria-label="Memory graph">
            <div class="panel-header">
              <p class="panel-title">Graph</p>
              <div class="summary-strip" id="graph-summary"></div>
            </div>
            <div class="graph-stage" id="graph-stage">
              <div class="empty-state">Choose a session to load its memory graph.</div>
            </div>
          </section>
          <section class="panel" aria-label="Selection details">
            <div class="panel-header">
              <p class="panel-title">Details</p>
            </div>
            <div class="details" id="details-panel">
              <p class="subtle">Select a node in the graph to inspect its metadata.</p>
            </div>
          </section>
        </div>
      </main>
    </div>
    <script type="application/json" id="studio-state">${serializedState}</script>
    <script>
      (function () {
        const initialState = JSON.parse(document.getElementById("studio-state").textContent);
        const state = {
          sessions: [],
          selectedSessionId: null,
          graph: null,
          selectedGraphNodeId: null,
          loadingSessions: false,
          loadingGraph: false,
          error: null,
          filters: {
            nodeType: "all",
            tag: "",
            lifecycle: "all"
          }
        };

        const elements = {
          databaseStatus: document.getElementById("database-status"),
          studioUrl: document.getElementById("studio-url"),
          sessionList: document.getElementById("session-list"),
          refreshSessions: document.getElementById("refresh-sessions"),
          refreshGraph: document.getElementById("refresh-graph"),
          pageTitle: document.getElementById("page-title"),
          pageSubtitle: document.getElementById("page-subtitle"),
          graphStage: document.getElementById("graph-stage"),
          graphSummary: document.getElementById("graph-summary"),
          detailsPanel: document.getElementById("details-panel"),
          nodeTypeFilter: document.getElementById("node-type-filter"),
          tagFilter: document.getElementById("tag-filter"),
          lifecycleFilter: document.getElementById("lifecycle-filter"),
          clearFilters: document.getElementById("clear-filters")
        };

        elements.databaseStatus.textContent = initialState.databaseStatus;
        elements.studioUrl.textContent = initialState.studioUrl;

        elements.refreshSessions.addEventListener("click", () => loadSessions());
        elements.refreshGraph.addEventListener("click", () => {
          if (state.selectedSessionId) loadGraph(state.selectedSessionId);
        });
        elements.nodeTypeFilter.addEventListener("change", () => {
          state.filters.nodeType = elements.nodeTypeFilter.value;
          renderGraph();
        });
        elements.tagFilter.addEventListener("input", () => {
          state.filters.tag = elements.tagFilter.value.trim().toLowerCase();
          renderGraph();
        });
        elements.lifecycleFilter.addEventListener("change", () => {
          state.filters.lifecycle = elements.lifecycleFilter.value;
          renderGraph();
        });
        elements.clearFilters.addEventListener("click", () => {
          state.filters = { nodeType: "all", tag: "", lifecycle: "all" };
          elements.nodeTypeFilter.value = "all";
          elements.tagFilter.value = "";
          elements.lifecycleFilter.value = "all";
          renderGraph();
        });

        loadSessions();

        async function loadSessions() {
          state.loadingSessions = true;
          renderSessions();
          try {
            const data = await fetchJson("/api/sessions");
            state.sessions = data.sessions || [];
            state.error = null;
          } catch (error) {
            state.error = error.message || String(error);
          } finally {
            state.loadingSessions = false;
            renderSessions();
          }
        }

        async function loadGraph(sessionId) {
          state.selectedSessionId = sessionId;
          state.graph = null;
          state.selectedGraphNodeId = null;
          state.loadingGraph = true;
          state.error = null;
          renderSessions();
          renderGraph();
          renderHeader();
          try {
            state.graph = await fetchJson("/api/sessions/" + encodeURIComponent(sessionId) + "/graph");
          } catch (error) {
            state.error = error.message || String(error);
          } finally {
            state.loadingGraph = false;
            renderSessions();
            renderHeader();
            renderGraph();
          }
        }

        async function fetchJson(url) {
          const response = await fetch(url, { headers: { accept: "application/json" } });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || body.message || "Request failed");
          }
          return body;
        }

        function renderSessions() {
          if (state.loadingSessions && state.sessions.length === 0) {
            elements.sessionList.innerHTML = '<li class="subtle" style="padding: 12px;">Loading sessions...</li>';
            return;
          }

          if (state.error && state.sessions.length === 0) {
            elements.sessionList.innerHTML = '<li class="subtle" style="padding: 12px;">' + escapeHtml(state.error) + '</li>';
            return;
          }

          if (state.sessions.length === 0) {
            elements.sessionList.innerHTML = '<li class="subtle" style="padding: 12px;">No sessions found.</li>';
            return;
          }

          elements.sessionList.innerHTML = state.sessions.map((session) => {
            const active = session.id === state.selectedSessionId ? "true" : "false";
            return '<li><button class="session-button" type="button" aria-current="' + active + '" data-session-id="' + escapeAttribute(session.id) + '">' +
              '<span class="session-id">' + escapeHtml(session.id) + '</span>' +
              '<span class="session-meta">' +
                '<span>' + numberText(session.topicCount) + ' topics</span>' +
                '<span>' + numberText(session.memoryCount) + ' memories</span>' +
                '<span>' + formatDate(session.lastUpdatedAt) + '</span>' +
              '</span>' +
              '<span class="tag-row">' + sessionBadges(session).map((label) => '<span class="badge">' + escapeHtml(label) + '</span>').join("") + '</span>' +
            '</button></li>';
          }).join("");

          elements.sessionList.querySelectorAll("[data-session-id]").forEach((button) => {
            button.addEventListener("click", () => loadGraph(button.getAttribute("data-session-id")));
          });
        }

        function renderHeader() {
          elements.refreshGraph.disabled = !state.selectedSessionId || state.loadingGraph;
          if (!state.selectedSessionId) {
            elements.pageTitle.textContent = "Select a session";
            elements.pageSubtitle.textContent = "Graph data loads only after you choose a session.";
            return;
          }

          elements.pageTitle.textContent = "Session " + state.selectedSessionId;
          elements.pageSubtitle.textContent = state.loadingGraph
            ? "Loading graph data..."
            : "Inspect topics, memories, edges, tags, and lifecycle metadata.";
        }

        function renderGraph() {
          renderHeader();

          if (state.loadingGraph) {
            elements.graphStage.innerHTML = '<div class="loading-state">Loading graph...</div>';
            elements.graphSummary.textContent = "";
            renderDetails(null);
            return;
          }

          if (state.error && state.selectedSessionId && !state.graph) {
            elements.graphStage.innerHTML = '<div class="error-state">' + escapeHtml(state.error) + '</div>';
            elements.graphSummary.textContent = "";
            renderDetails(null);
            return;
          }

          if (!state.graph) {
            elements.graphStage.innerHTML = '<div class="empty-state">Choose a session to load its memory graph.</div>';
            elements.graphSummary.textContent = "";
            renderDetails(null);
            return;
          }

          const graph = buildDisplayGraph(state.graph);
          elements.graphSummary.innerHTML =
            '<span>' + numberText(graph.topicNodes.length) + ' topics</span>' +
            '<span>' + numberText(graph.memoryNodes.length) + ' memories</span>' +
            '<span>' + numberText(graph.topicEdges.length) + ' topic edges</span>' +
            '<span>' + numberText(graph.memoryEdges.length) + ' memory edges</span>';

          if (graph.nodes.length === 0) {
            elements.graphStage.innerHTML = '<div class="empty-state">No nodes match the current filters.</div>';
            renderDetails(null);
            return;
          }

          elements.graphStage.innerHTML = renderGraphSvg(graph);
          elements.graphStage.querySelectorAll("[data-graph-node-id]").forEach((node) => {
            node.addEventListener("click", () => {
              state.selectedGraphNodeId = node.getAttribute("data-graph-node-id");
              renderGraph();
            });
          });

          const selected = graph.nodes.find((node) => node.id === state.selectedGraphNodeId) || graph.nodes[0];
          if (selected && !state.selectedGraphNodeId) state.selectedGraphNodeId = selected.id;
          renderDetails(selected || null);
        }

        function buildDisplayGraph(raw) {
          const topics = (raw.nodes || []).map((node) => ({
            id: node.id,
            kind: "topic",
            title: node.label || node.id,
            subtitle: node.summary || "",
            tags: node.tags || [],
            lifecycle: node.suppressed ? "suppressed" : "active",
            raw: node
          }));
          const memories = (raw.memories || []).map((memory) => ({
            id: memory.id,
            kind: "memory",
            title: memory.subject ? memory.subject + " " + memory.predicate : memory.id,
            subtitle: memory.value || "",
            tags: memory.tags || [],
            lifecycle: memoryLifecycle(memory),
            raw: memory
          }));

          const topicNodes = topics.filter(matchesFilters);
          const memoryNodes = memories.filter(matchesFilters);
          const visibleIds = new Set(topicNodes.concat(memoryNodes).map((node) => node.id));
          const topicEdges = (raw.edges || []).filter((edge) => visibleIds.has(edge.srcId) && visibleIds.has(edge.dstId));
          const memoryEdges = (raw.memoryEdges || []).filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
          const attachmentEdges = memoryNodes
            .filter((memory) => visibleIds.has(memory.raw.topicNodeId))
            .map((memory) => ({ srcId: memory.raw.topicNodeId, dstId: memory.id, type: "contains", weight: 1 }));

          return {
            topicNodes,
            memoryNodes,
            nodes: topicNodes.concat(memoryNodes),
            topicEdges: topicEdges.concat(attachmentEdges.filter((edge) => visibleIds.has(edge.srcId))),
            memoryEdges
          };
        }

        function matchesFilters(node) {
          if (state.filters.nodeType === "topics" && node.kind !== "topic") return false;
          if (state.filters.nodeType === "memories" && node.kind !== "memory") return false;
          if (state.filters.lifecycle !== "all" && node.lifecycle !== state.filters.lifecycle) return false;
          if (state.filters.tag) {
            const haystack = (node.tags || []).join(" ").toLowerCase();
            if (!haystack.includes(state.filters.tag)) return false;
          }
          return true;
        }

        function renderGraphSvg(graph) {
          const rowGap = 108;
          const nodeWidth = 260;
          const nodeHeight = 72;
          const topicX = 50;
          const memoryX = 420;
          const topicPositions = new Map();
          const memoryPositions = new Map();

          graph.topicNodes.forEach((node, index) => topicPositions.set(node.id, {
            x: topicX,
            y: 42 + index * rowGap
          }));
          graph.memoryNodes.forEach((node, index) => memoryPositions.set(node.id, {
            x: memoryX,
            y: 42 + index * rowGap
          }));

          const positions = new Map([...topicPositions, ...memoryPositions]);
          const height = Math.max(560, 140 + Math.max(graph.topicNodes.length, graph.memoryNodes.length) * rowGap);
          const width = 760;
          const edgeMarkup = graph.topicEdges.map((edge) => renderLine(edge.srcId, edge.dstId, positions, nodeWidth, nodeHeight, "topic"))
            .concat(graph.memoryEdges.map((edge) => renderLine(edge.sourceId, edge.targetId, positions, nodeWidth, nodeHeight, "memory")))
            .join("");
          const nodeMarkup = graph.nodes.map((node) => renderNode(node, positions.get(node.id), nodeWidth, nodeHeight)).join("");

          return '<svg class="graph-svg" role="img" aria-label="Session memory graph" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
            edgeMarkup +
            nodeMarkup +
          '</svg>';
        }

        function renderLine(fromId, toId, positions, nodeWidth, nodeHeight, kind) {
          const from = positions.get(fromId);
          const to = positions.get(toId);
          if (!from || !to) return "";
          const x1 = from.x + nodeWidth;
          const y1 = from.y + nodeHeight / 2;
          const x2 = to.x;
          const y2 = to.y + nodeHeight / 2;
          return '<line class="edge-line ' + kind + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"></line>';
        }

        function renderNode(node, position, width, height) {
          if (!position) return "";
          const selected = node.id === state.selectedGraphNodeId ? " selected" : "";
          return '<g class="node-card ' + node.kind + selected + '" tabindex="0" role="button" data-graph-node-id="' + escapeAttribute(node.id) + '">' +
            '<rect x="' + position.x + '" y="' + position.y + '" width="' + width + '" height="' + height + '" rx="8"></rect>' +
            '<text class="node-kind" x="' + (position.x + 14) + '" y="' + (position.y + 20) + '">' + escapeHtml(node.kind + " - " + node.lifecycle) + '</text>' +
            '<text x="' + (position.x + 14) + '" y="' + (position.y + 40) + '">' + escapeHtml(truncate(node.title, 32)) + '</text>' +
            '<text x="' + (position.x + 14) + '" y="' + (position.y + 58) + '">' + escapeHtml(truncate(node.subtitle, 38)) + '</text>' +
          '</g>';
        }

        function renderDetails(node) {
          if (!node) {
            elements.detailsPanel.innerHTML = '<p class="subtle">Select a node in the graph to inspect its metadata.</p>';
            return;
          }

          const raw = node.raw || {};
          elements.detailsPanel.innerHTML =
            detailRow("Type", node.kind) +
            detailRow("ID", node.id) +
            detailRow("Lifecycle", node.lifecycle) +
            detailRow("Title", node.title) +
            detailRow("Summary", node.subtitle || "None") +
            detailRow("Tags", tagsMarkup(node.tags)) +
            detailRow("Created", formatDate(raw.createdAt)) +
            (node.kind === "memory" ? detailRow("Confidence", raw.confidence == null ? "Unknown" : String(raw.confidence)) : "") +
            (node.kind === "topic" ? detailRow("Topic order", raw.topicOrder == null ? "Unknown" : String(raw.topicOrder)) : "");
        }

        function detailRow(label, value) {
          return '<div class="detail-row"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + value + '</span></div>';
        }

        function tagsMarkup(tags) {
          if (!tags || tags.length === 0) return "None";
          return '<span class="tag-row">' + tags.map((tag) => '<span class="badge">' + escapeHtml(tag) + '</span>').join("") + '</span>';
        }

        function memoryLifecycle(memory) {
          if (memory.forgotten) return "forgotten";
          if (memory.decayed) return "decayed";
          if (memory.supersededBy) return "superseded";
          if (memory.hasConflict) return "conflicting";
          return "active";
        }

        function sessionBadges(session) {
          const labels = [];
          if (session.id && session.id.startsWith("fleet:")) labels.push("fleet");
          if (session.id && session.id.includes(":shared")) labels.push("shared");
          return labels;
        }

        function numberText(value) {
          return new Intl.NumberFormat().format(value || 0);
        }

        function formatDate(value) {
          if (!value) return "No activity";
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return "No activity";
          return date.toLocaleString();
        }

        function truncate(value, length) {
          const text = String(value || "");
          if (text.length <= length) return text;
          return text.slice(0, Math.max(0, length - 1)) + "...";
        }

        function escapeHtml(value) {
          return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function escapeAttribute(value) {
          return escapeHtml(value);
        }
      })();
    </script>
  </body>
</html>`;
}
