export interface StudioFrontendState {
  databaseStatus: "connected" | "error";
  sessionCount: number;
  studioUrl: string;
  previewStatus?: {
    available: boolean;
    reason?: string;
  };
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

      .workspace-tabs {
        align-items: center;
        border-bottom: 1px solid #d8dee9;
        display: flex;
        gap: 4px;
        margin-bottom: 16px;
      }

      .tab-button {
        background: transparent;
        border: 0;
        border-bottom: 3px solid transparent;
        color: #55657b;
        font-weight: 750;
        padding: 10px 12px;
      }

      .tab-button[aria-selected="true"] {
        border-bottom-color: #3d6fb6;
        color: #1f2a3a;
      }

      .workspace-placeholder {
        color: #66758a;
        display: grid;
        gap: 10px;
        min-height: 508px;
        place-items: center;
        text-align: center;
      }

      .placeholder-card {
        display: grid;
        gap: 8px;
        max-width: 560px;
      }

      .table-stack {
        display: grid;
        gap: 16px;
        padding: 14px;
      }

      .data-table-section {
        border: 1px solid #e0e5ee;
        border-radius: 8px;
        overflow: hidden;
      }

      .data-table-heading {
        align-items: center;
        background: #f8fbff;
        border-bottom: 1px solid #e0e5ee;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
      }

      .data-table-wrap {
        max-height: 320px;
        overflow: auto;
      }

      .data-table {
        border-collapse: collapse;
        font-size: 12px;
        min-width: 860px;
        width: 100%;
      }

      .data-table th,
      .data-table td {
        border-bottom: 1px solid #edf1f6;
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }

      .data-table th {
        background: #ffffff;
        color: #53647a;
        font-size: 11px;
        font-weight: 800;
        position: sticky;
        text-transform: uppercase;
        top: 0;
        z-index: 1;
      }

      .data-table tr {
        cursor: pointer;
      }

      .data-table tr:hover td {
        background: #f8fbff;
      }

      .data-table tr.selected td {
        background: #eef6ff;
      }

      .table-cell-clip {
        display: inline-block;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: top;
        white-space: nowrap;
      }

      .table-empty {
        color: #66758a;
        font-size: 13px;
        padding: 16px;
      }

      .content-grid.tables-active {
        grid-template-columns: minmax(0, 1fr);
      }

      .table-browser {
        display: grid;
        gap: 14px;
        padding: 14px;
      }

      .table-browser-toolbar,
      .pagination-controls,
      .cell-meta {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .table-browser-toolbar {
        justify-content: space-between;
      }

      .table-browser-controls {
        align-items: end;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .table-select {
        min-width: 260px;
      }

      .db-table {
        border-collapse: collapse;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 12px;
        min-width: 920px;
        width: 100%;
      }

      .db-table th,
      .db-table td {
        border-bottom: 1px solid #edf1f6;
        max-width: 340px;
        padding: 8px 10px;
        text-align: left;
        vertical-align: top;
      }

      .db-table th {
        background: #ffffff;
        color: #53647a;
        font-size: 11px;
        font-weight: 800;
        position: sticky;
        text-transform: uppercase;
        top: 0;
        z-index: 1;
      }

      .db-cell {
        cursor: pointer;
      }

      .db-cell:hover {
        background: #f8fbff;
      }

      .db-cell.selected {
        background: #eef6ff;
        box-shadow: inset 0 0 0 2px #3d6fb6;
      }

      .db-cell-expanded {
        display: block;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        line-height: 1.5;
        max-height: 260px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
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
        gap: 16px;
        padding: 14px;
      }

      .detail-section {
        display: grid;
        gap: 10px;
      }

      .detail-section + .detail-section {
        border-top: 1px solid #dbe2eb;
        padding-top: 14px;
      }

      .detail-section-title {
        color: #34445a;
        font-size: 12px;
        font-weight: 800;
        margin: 0;
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

      .detail-list {
        display: grid;
        gap: 6px;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .detail-link {
        background: transparent;
        border: 0;
        color: #1d4ed8;
        cursor: pointer;
        font: inherit;
        padding: 0;
        text-align: left;
      }

      .detail-link:hover {
        text-decoration: underline;
      }

      .detail-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .danger-button {
        background: #fff;
        border: 1px solid #c2413b;
        color: #a52f2a;
      }

      .action-status {
        border-left: 3px solid;
        font-size: 13px;
        line-height: 1.45;
        padding: 8px 10px;
      }

      .action-status.success {
        background: #edf8f1;
        border-color: #27814c;
        color: #176238;
      }

      .action-status.error {
        background: #fff1f0;
        border-color: #c2413b;
        color: #922d28;
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

        <div class="workspace-tabs" role="tablist" aria-label="Session workspace tabs">
          <button class="tab-button" id="tab-graph" type="button" role="tab" aria-controls="workspace-panel" aria-selected="true" data-tab="graph">Graph</button>
          <button class="tab-button" id="tab-tables" type="button" role="tab" aria-controls="workspace-panel" aria-selected="false" data-tab="tables">Tables</button>
          <button class="tab-button" id="tab-preview" type="button" role="tab" aria-controls="workspace-panel" aria-selected="false" data-tab="preview">Prompt Preview</button>
        </div>

        <div class="filters" id="graph-filters" aria-label="Graph filters">
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

        <div class="content-grid" id="content-grid">
          <section class="panel graph-panel" id="workspace-panel" aria-label="Session workspace">
            <div class="panel-header">
              <p class="panel-title" id="workspace-title">Graph</p>
              <div class="summary-strip" id="graph-summary"></div>
            </div>
            <div class="graph-stage" id="graph-stage">
              <div class="empty-state">Choose a session to load its memory graph.</div>
            </div>
          </section>
          <section class="panel" id="details-section" aria-label="Selection details">
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
          activeTab: "graph",
          graph: null,
          tables: null,
          selectedGraphNodeId: null,
          selectedEntity: null,
          tablesBrowser: {
            selectedTable: "mg_topic_nodes",
            page: 1,
            pageSize: 25,
            expandedCell: null
          },
          loadingSessions: false,
          loadingGraph: false,
          tabs: {
            graph: { loading: false, error: null, loadedAt: null },
            tables: { loading: false, error: null, loadedAt: null },
            preview: { loading: false, error: null, loadedAt: null }
          },
          actionPending: false,
          actionStatus: null,
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
          tabButtons: Array.from(document.querySelectorAll("[data-tab]")),
          graphFilters: document.getElementById("graph-filters"),
          contentGrid: document.getElementById("content-grid"),
          workspaceTitle: document.getElementById("workspace-title"),
          graphStage: document.getElementById("graph-stage"),
          graphSummary: document.getElementById("graph-summary"),
          detailsSection: document.getElementById("details-section"),
          detailsPanel: document.getElementById("details-panel"),
          nodeTypeFilter: document.getElementById("node-type-filter"),
          tagFilter: document.getElementById("tag-filter"),
          lifecycleFilter: document.getElementById("lifecycle-filter"),
          clearFilters: document.getElementById("clear-filters")
        };

        elements.databaseStatus.textContent = initialState.databaseStatus;
        elements.studioUrl.textContent = initialState.studioUrl;

        elements.refreshSessions.addEventListener("click", () => loadSessions());
        elements.refreshGraph.addEventListener("click", () => refreshActiveTab());
        elements.tabButtons.forEach((button) => {
          button.addEventListener("click", () => selectTab(button.getAttribute("data-tab")));
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

        async function loadGraph(sessionId, options) {
          const preserveSelection = Boolean(options && options.preserveSelection && state.selectedSessionId === sessionId);
          const selectedGraphNodeId = preserveSelection ? state.selectedGraphNodeId : null;
          state.selectedSessionId = sessionId;
          state.activeTab = "graph";
          if (!preserveSelection) {
            state.graph = null;
            state.tables = null;
            state.selectedEntity = null;
            state.actionStatus = null;
          }
          state.selectedGraphNodeId = selectedGraphNodeId;
          state.loadingGraph = true;
          state.tabs.graph.loading = true;
          state.tabs.graph.error = null;
          state.error = null;
          renderSessions();
          renderWorkspace();
          renderHeader();
          try {
            state.graph = await fetchJson("/api/sessions/" + encodeURIComponent(sessionId) + "/graph");
            state.tabs.graph.loadedAt = new Date().toISOString();
            return true;
          } catch (error) {
            state.error = error.message || String(error);
            state.tabs.graph.error = state.error;
            return false;
          } finally {
            state.loadingGraph = false;
            state.tabs.graph.loading = false;
            renderSessions();
            renderHeader();
            renderWorkspace();
          }
        }

        async function loadTables(sessionId, options) {
          const force = Boolean(options && options.force);
          if (!force && state.tables && state.selectedSessionId === sessionId) {
            renderWorkspace();
            return true;
          }

          state.tabs.tables.loading = true;
          state.tabs.tables.error = null;
          renderWorkspace();

          try {
            state.tables = await fetchJson("/api/sessions/" + encodeURIComponent(sessionId) + "/tables");
            state.tabs.tables.loadedAt = new Date().toISOString();
            return true;
          } catch (error) {
            state.tabs.tables.error = error.message || String(error);
            return false;
          } finally {
            state.tabs.tables.loading = false;
            renderWorkspace();
          }
        }

        function selectTab(tab) {
          if (!tab || !state.tabs[tab] || state.activeTab === tab) return;
          state.activeTab = tab;
          state.actionStatus = null;
          renderWorkspace();
          renderHeader();

          if (tab === "tables" && state.selectedSessionId) {
            void loadTables(state.selectedSessionId);
          }
        }

        function refreshActiveTab() {
          if (!state.selectedSessionId) return;
          state.actionStatus = null;

          if (state.activeTab === "tables") {
            void loadTables(state.selectedSessionId, { force: true });
            return;
          }

          if (state.activeTab === "preview") {
            state.tabs.preview.loadedAt = new Date().toISOString();
            renderWorkspace();
            return;
          }

          void loadGraph(state.selectedSessionId, { preserveSelection: true });
        }

        async function fetchJson(url, options) {
          const requestOptions = options || {};
          const response = await fetch(url, {
            ...requestOptions,
            headers: { accept: "application/json", ...(requestOptions.headers || {}) }
          });
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
          const activeTabState = state.tabs[state.activeTab] || state.tabs.graph;
          elements.refreshGraph.disabled = !state.selectedSessionId || activeTabState.loading;
          elements.refreshGraph.innerHTML = '<span class="icon">R</span>Refresh ' + tabLabel(state.activeTab);
          if (!state.selectedSessionId) {
            elements.pageTitle.textContent = "Select a session";
            elements.pageSubtitle.textContent = "Workspace data loads only after you choose a session.";
            return;
          }

          elements.pageTitle.textContent = "Session " + state.selectedSessionId;
          elements.pageSubtitle.textContent = activeTabState.loading
            ? "Loading " + tabLabel(state.activeTab).toLowerCase() + " data..."
            : "Inspect graph, table, and prompt-preview data without editing stored memory.";
        }

        function tabLabel(tab) {
          if (tab === "tables") return "Tables";
          if (tab === "preview") return "Prompt Preview";
          return "Graph";
        }

        function renderWorkspace() {
          elements.tabButtons.forEach((button) => {
            const active = button.getAttribute("data-tab") === state.activeTab;
            button.setAttribute("aria-selected", active ? "true" : "false");
          });
          elements.graphFilters.classList.toggle("hidden", state.activeTab !== "graph");
          elements.contentGrid.classList.toggle("tables-active", state.activeTab === "tables");
          elements.detailsSection.classList.toggle("hidden", state.activeTab === "tables");
          elements.workspaceTitle.textContent = tabLabel(state.activeTab);
          renderHeader();

          if (!state.selectedSessionId) {
            elements.graphStage.innerHTML = '<div class="empty-state">Choose a session to load its workspace.</div>';
            elements.graphSummary.textContent = "";
            renderDetailsPanel();
            return;
          }

          if (state.activeTab === "tables") {
            renderTables();
            return;
          }

          if (state.activeTab === "preview") {
            renderPreviewPlaceholder();
            return;
          }

          renderGraph();
        }

        function renderTables() {
          const tab = state.tabs.tables;
          elements.graphSummary.textContent = "";

          if (tab.loading && !state.tables) {
            elements.graphStage.innerHTML = '<div class="loading-state">Loading tables...</div>';
            renderDetailsPanel();
            return;
          }

          if (tab.error && !state.tables) {
            elements.graphStage.innerHTML = '<div class="error-state">' + escapeHtml(tab.error) + '</div>';
            renderDetailsPanel();
            return;
          }

          const browserTables = getBrowserTables();
          ensureSelectedBrowserTable(browserTables);
          const table = browserTables.find((candidate) => candidate.name === state.tablesBrowser.selectedTable) || browserTables[0];
          const totalRows = table ? table.rows.length : 0;
          const pageSize = state.tablesBrowser.pageSize;
          const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
          state.tablesBrowser.page = Math.min(Math.max(1, state.tablesBrowser.page), totalPages);
          const start = (state.tablesBrowser.page - 1) * pageSize;
          const visibleRows = table ? table.rows.slice(start, start + pageSize) : [];
          const columns = getTableColumns(table);

          elements.graphSummary.innerHTML = browserTables.map((candidate) =>
            '<span>' + escapeHtml(candidate.name) + ': ' + numberText(candidate.rows.length) + '</span>'
          ).join("");
          elements.graphStage.innerHTML = renderTableBrowser(browserTables, table, columns, visibleRows, start, totalRows, totalPages);

          const tableSelect = elements.graphStage.querySelector("[data-table-browser-select]");
          if (tableSelect) {
            tableSelect.addEventListener("change", () => {
              state.tablesBrowser.selectedTable = tableSelect.value;
              state.tablesBrowser.page = 1;
              state.tablesBrowser.expandedCell = null;
              renderWorkspace();
            });
          }

          const pageSizeSelect = elements.graphStage.querySelector("[data-table-page-size]");
          if (pageSizeSelect) {
            pageSizeSelect.addEventListener("change", () => {
              state.tablesBrowser.pageSize = Number.parseInt(pageSizeSelect.value, 10) || 25;
              state.tablesBrowser.page = 1;
              state.tablesBrowser.expandedCell = null;
              renderWorkspace();
            });
          }

          elements.graphStage.querySelectorAll("[data-page-action]").forEach((button) => {
            button.addEventListener("click", () => {
              const action = button.getAttribute("data-page-action");
              state.tablesBrowser.page += action === "next" ? 1 : -1;
              state.tablesBrowser.expandedCell = null;
              renderWorkspace();
            });
          });

          elements.graphStage.querySelectorAll("[data-db-cell-column]").forEach((cell) => {
            cell.addEventListener("click", () => {
              const rowIndex = Number.parseInt(cell.getAttribute("data-db-cell-row") || "0", 10);
              const columnName = cell.getAttribute("data-db-cell-column") || "";
              const current = state.tablesBrowser.expandedCell;
              state.tablesBrowser.expandedCell = current
                && current.tableName === table.name
                && current.rowIndex === rowIndex
                && current.columnName === columnName
                  ? null
                  : { tableName: table.name, rowIndex, columnName };
              renderWorkspace();
            });
          });
        }

        function getBrowserTables() {
          if (state.tables && Array.isArray(state.tables.tables) && state.tables.tables.length > 0) {
            return state.tables.tables.map((table) => ({
              name: table.name,
              rows: (table.rows || []).map(normalizeDbRow)
            }));
          }

          const source = state.tables || {};
          return [
            { name: "mg_message_buffer", rows: (source.messages || []).map((message, index) => normalizeDbRow({ message_index: index, role: message.role, content: message.content })) },
            { name: "mg_segments", rows: (source.segments || []).map((segment) => normalizeDbRow(toSnakeRow(segment))) },
            { name: "mg_topic_nodes", rows: (source.topics || []).map((topic) => normalizeDbRow(toSnakeRow(topic))) },
            { name: "mg_memory_nodes", rows: (source.memories || []).map((memory) => normalizeDbRow(toSnakeRow(memory))) }
          ];
        }

        function ensureSelectedBrowserTable(tables) {
          if (!tables.some((table) => table.name === state.tablesBrowser.selectedTable)) {
            state.tablesBrowser.selectedTable = tables[0] ? tables[0].name : "mg_topic_nodes";
            state.tablesBrowser.page = 1;
            state.tablesBrowser.expandedCell = null;
          }
        }

        function renderTableBrowser(tables, table, columns, rows, start, totalRows, totalPages) {
          const selectedName = table ? table.name : "";
          return '<div class="table-browser">' +
            '<div class="table-browser-toolbar">' +
              '<div class="table-browser-controls">' +
                '<div class="field"><label for="table-browser-select">Table</label><select class="table-select" id="table-browser-select" data-table-browser-select>' +
                  tables.map((candidate) => '<option value="' + escapeAttribute(candidate.name) + '"' + (candidate.name === selectedName ? " selected" : "") + '>' + escapeHtml(candidate.name) + '</option>').join("") +
                '</select></div>' +
                '<div class="field"><label for="table-page-size">Page size</label><select id="table-page-size" data-table-page-size>' +
                  [10, 25, 50, 100].map((size) => '<option value="' + size + '"' + (size === state.tablesBrowser.pageSize ? " selected" : "") + '>' + size + '</option>').join("") +
                '</select></div>' +
              '</div>' +
              '<div class="pagination-controls">' +
                '<span class="subtle">' + escapeHtml(numberText(totalRows)) + ' rows · page ' + numberText(state.tablesBrowser.page) + ' of ' + numberText(totalPages) + '</span>' +
                '<button class="icon-button" type="button" data-page-action="previous"' + (state.tablesBrowser.page <= 1 ? " disabled" : "") + '>Previous</button>' +
                '<button class="icon-button" type="button" data-page-action="next"' + (state.tablesBrowser.page >= totalPages ? " disabled" : "") + '>Next</button>' +
              '</div>' +
            '</div>' +
            renderDbTable(selectedName, columns, rows, start) +
          '</div>';
        }

        function renderDbTable(tableName, columns, rows, start) {
          if (!tableName) return '<div class="table-empty">No tables are available for this session.</div>';
          if (columns.length === 0) return '<div class="table-empty">' + escapeHtml(tableName) + ' has no rows to display.</div>';

          return '<div class="data-table-section">' +
            '<div class="data-table-heading"><p class="panel-title">' + escapeHtml(tableName) + '</p><span class="badge">read-only</span></div>' +
            '<div class="data-table-wrap"><table class="db-table"><thead><tr>' +
              columns.map((column) => '<th scope="col">' + escapeHtml(column) + '</th>').join("") +
            '</tr></thead><tbody>' +
              rows.map((row, index) => {
                const absoluteRow = start + index + 1;
                return '<tr>' + columns.map((column) => renderDbCell(tableName, row, absoluteRow, column)).join("") + '</tr>';
              }).join("") +
            '</tbody></table></div>' +
          '</div>';
        }

        function renderDbCell(tableName, row, rowIndex, columnName) {
          const expanded = state.tablesBrowser.expandedCell
            && state.tablesBrowser.expandedCell.tableName === tableName
            && state.tablesBrowser.expandedCell.rowIndex === rowIndex
            && state.tablesBrowser.expandedCell.columnName === columnName;
          const value = expanded ? formatFullCellValue(row[columnName]) : formatCellPreview(row[columnName]);
          return '<td class="db-cell' + (expanded ? " selected" : "") + '" tabindex="0" title="Click to expand or collapse" data-db-cell-row="' + rowIndex + '" data-db-cell-column="' + escapeAttribute(columnName) + '">' +
            (expanded
              ? '<span class="db-cell-expanded">' + escapeHtml(value) + '</span>'
              : clipped(value, 260)) +
          '</td>';
        }

        function getTableColumns(table) {
          if (!table) return [];
          const preferred = tableColumnOrder(table.name);
          const observed = [];
          for (const row of table.rows) {
            Object.keys(row).forEach((key) => {
              if (!observed.includes(key)) observed.push(key);
            });
          }
          return preferred.filter((column) => observed.includes(column))
            .concat(observed.filter((column) => !preferred.includes(column)));
        }

        function tableColumnOrder(name) {
          const columns = {
            mg_message_buffer: ["session_id", "message_index", "role", "content"],
            mg_segments: ["id", "session_id", "start_index", "end_index", "topic_order", "drift_score", "created_at"],
            mg_topic_nodes: ["id", "session_id", "segment_id", "label", "summary", "embedding", "tags", "source", "message_range", "topic_order", "drift_score", "agent_color", "fleet_id", "agent_id", "suppressed", "suppressed_at", "created_at"],
            mg_topic_edges: ["src_id", "dst_id", "weight", "type"],
            mg_memory_nodes: ["id", "segment_id", "topic_node_id", "agent_id", "session_id", "memory_type", "source_type", "subject", "predicate", "value", "confidence", "embedding", "tags", "source", "source_url", "source_title", "superseded_by", "decayed", "forgotten", "forgotten_at", "has_conflict", "agent_color", "fleet_id", "created_at"],
            mg_memory_edges: ["id", "source_id", "target_id", "edge_type", "weight", "created_at"],
            mg_fleets: ["id", "name", "created_at"],
            mg_fleet_agents: ["id", "fleet_id", "session_id", "agent_color", "created_at"],
            mg_session_ingest_state: ["session_id", "last_ingested_message_index", "updated_at"],
            mg_graft_registry: ["id", "session_id", "node_id", "source_session_id", "source_node_id", "grafted_at"]
          };
          return columns[name] || [];
        }

        function normalizeDbRow(row) {
          const normalized = {};
          Object.entries(row || {}).forEach(([key, value]) => {
            normalized[toSnakeCase(key)] = value;
          });
          return normalized;
        }

        function toSnakeRow(row) {
          return normalizeDbRow(row);
        }

        function toSnakeCase(value) {
          return String(value).replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
        }

        function formatCellPreview(value) {
          if (value === null) return "null";
          if (value === undefined) return "undefined";
          if (Array.isArray(value)) return JSON.stringify(value);
          if (typeof value === "object") return JSON.stringify(value);
          return String(value);
        }

        function formatFullCellValue(value) {
          if (value === null) return "null";
          if (value === undefined) return "undefined";
          if (typeof value === "object") return JSON.stringify(value, null, 2);
          return String(value);
        }

        function normalizeTables(raw) {
          const source = raw || {};
          return {
            topics: (source.topics || []).map((topic) => ({
              id: topic.id,
              kind: "topic",
              raw: topic,
              title: topic.label || topic.id,
              subtitle: topic.summary || "",
              tags: topic.tags || [],
              lifecycle: topic.suppressed ? "suppressed" : "active"
            })),
            memories: (source.memories || []).map((memory) => ({
              id: memory.id,
              kind: "memory",
              raw: memory,
              title: memory.subject ? memory.subject + " " + memory.predicate : memory.id,
              subtitle: memory.value || "",
              tags: memory.tags || [],
              lifecycle: memoryLifecycle(memory)
            })),
            segments: (source.segments || []).map((segment) => ({
              id: segment.id,
              kind: "segment",
              raw: segment
            })),
            messages: (source.messages || []).map((message, index) => ({
              id: "message:" + index,
              kind: "message",
              index,
              raw: message
            }))
          };
        }

        function ensureSelectedEntityExists(tables) {
          if (!state.selectedEntity || state.selectedEntity.source !== "tables") return;
          const bucket = state.selectedEntity.kind === "topic" ? tables.topics
            : state.selectedEntity.kind === "memory" ? tables.memories
              : state.selectedEntity.kind === "segment" ? tables.segments
                : state.selectedEntity.kind === "message" ? tables.messages
                  : [];
          if (!bucket.some((item) => item.id === state.selectedEntity.id)) {
            state.selectedEntity = null;
          }
        }

        function renderTopicTable(rows) {
          return renderDataTable("Topics", rows.length, ["Label", "Summary", "Tags", "Lifecycle", "Message range", "Created", "ID"], rows.map((row) => {
            const raw = row.raw;
            return tableRow(row, [
              clipped(raw.label || raw.id, 180),
              clipped(raw.summary || "None", 320),
              tagsMarkup(raw.tags || []),
              badgeMarkup(row.lifecycle),
              escapeHtml(formatMessageRange(raw.messageRange)),
              escapeHtml(formatDate(raw.createdAt)),
              clipped(raw.id, 180)
            ]);
          }));
        }

        function renderMemoryTable(rows) {
          return renderDataTable("Memories", rows.length, ["Subject", "Predicate", "Value", "Type", "Confidence", "Lifecycle", "Tags", "Created", "ID"], rows.map((row) => {
            const raw = row.raw;
            return tableRow(row, [
              clipped(raw.subject || "None", 160),
              clipped(raw.predicate || "None", 140),
              clipped(raw.value || "None", 320),
              escapeHtml(raw.memoryType || "Unknown"),
              escapeHtml(raw.confidence == null ? "Unknown" : String(raw.confidence)),
              badgeMarkup(row.lifecycle),
              tagsMarkup(raw.tags || []),
              escapeHtml(formatDate(raw.createdAt)),
              clipped(raw.id, 180)
            ]);
          }));
        }

        function renderSegmentTable(rows) {
          return renderDataTable("Segments", rows.length, ["Order", "Message range", "Drift score", "Created", "ID"], rows.map((row) => {
            const raw = row.raw;
            return tableRow(row, [
              escapeHtml(raw.topicOrder == null ? "Unknown" : String(raw.topicOrder)),
              escapeHtml(formatSegmentRange(raw)),
              escapeHtml(raw.driftScore == null ? "Unknown" : String(raw.driftScore)),
              escapeHtml(formatDate(raw.createdAt)),
              clipped(raw.id, 220)
            ]);
          }));
        }

        function renderMessageTable(rows) {
          return renderDataTable("Message buffer", rows.length, ["Index", "Role", "Content", "Approx length"], rows.map((row) => {
            const raw = row.raw;
            const content = raw.content || "";
            return tableRow(row, [
              escapeHtml(String(row.index)),
              badgeMarkup(raw.role || "unknown"),
              clipped(content, 520),
              escapeHtml(numberText(content.length) + " chars")
            ]);
          }));
        }

        function renderDataTable(title, count, columns, rowMarkup) {
          return '<section class="data-table-section">' +
            '<div class="data-table-heading"><p class="panel-title">' + escapeHtml(title) + '</p><span class="badge">' + numberText(count) + '</span></div>' +
            (count === 0
              ? '<div class="table-empty">No ' + escapeHtml(title.toLowerCase()) + ' found for this session.</div>'
              : '<div class="data-table-wrap"><table class="data-table"><thead><tr>' +
                columns.map((column) => '<th scope="col">' + escapeHtml(column) + '</th>').join("") +
                '</tr></thead><tbody>' + rowMarkup.join("") + '</tbody></table></div>') +
          '</section>';
        }

        function tableRow(row, cells) {
          const selected = state.selectedEntity && state.selectedEntity.kind === row.kind && state.selectedEntity.id === row.id ? " selected" : "";
          return '<tr class="' + selected + '" tabindex="0" data-table-entity-kind="' + escapeAttribute(row.kind) + '" data-table-entity-id="' + escapeAttribute(row.id) + '">' +
            cells.map((cell) => '<td>' + cell + '</td>').join("") +
          '</tr>';
        }

        function clipped(value, length) {
          return '<span class="table-cell-clip" title="' + escapeAttribute(value || "") + '">' + escapeHtml(truncate(value || "", length)) + '</span>';
        }

        function badgeMarkup(label) {
          return '<span class="badge">' + escapeHtml(label || "unknown") + '</span>';
        }

        function renderTablesPlaceholder() {
          const tab = state.tabs.tables;
          elements.graphSummary.textContent = "";

          if (tab.loading && !state.tables) {
            elements.graphStage.innerHTML = '<div class="loading-state">Loading tables...</div>';
            renderDetailsPanel();
            return;
          }

          if (tab.error && !state.tables) {
            elements.graphStage.innerHTML = '<div class="error-state">' + escapeHtml(tab.error) + '</div>';
            renderDetailsPanel();
            return;
          }

          const counts = state.tables
            ? [
              numberText((state.tables.topics || []).length) + " topics",
              numberText((state.tables.memories || []).length) + " memories",
              numberText((state.tables.segments || []).length) + " segments",
              numberText((state.tables.messages || []).length) + " messages"
            ]
            : ["not loaded"];
          elements.graphSummary.innerHTML = counts.map((label) => '<span>' + escapeHtml(label) + '</span>').join("");
          elements.graphStage.innerHTML =
            '<div class="workspace-placeholder"><div class="placeholder-card">' +
              '<h2 class="panel-title">Tables</h2>' +
              '<p class="subtle">Tables data is available through the read-only tables workspace.</p>' +
              '<p class="subtle">' + escapeHtml(counts.join(" · ")) + '</p>' +
            '</div></div>';
          renderDetailsPanel();
        }

        function renderPreviewPlaceholder() {
          const status = initialState.previewStatus || { available: false, reason: "Prompt Preview is not configured." };
          elements.graphSummary.innerHTML = '<span>' + (status.available ? "available" : "unavailable") + '</span>';
          elements.graphStage.innerHTML =
            '<div class="workspace-placeholder"><div class="placeholder-card">' +
              '<h2 class="panel-title">Prompt Preview workspace shell</h2>' +
              '<p class="subtle">Preview status: ' + escapeHtml(status.available ? "available" : "unavailable") + '</p>' +
              '<p class="subtle">' + escapeHtml(status.available ? "Prompt controls land in Phase 5." : (status.reason || "Prompt Preview is unavailable.")) + '</p>' +
            '</div></div>';
          renderDetailsPanel();
        }

        function renderGraph() {
          renderHeader();

          if (state.loadingGraph && !state.graph) {
            elements.graphStage.innerHTML = '<div class="loading-state">Loading graph...</div>';
            elements.graphSummary.textContent = "";
            renderDetailsPanel();
            return;
          }

          if (state.error && state.selectedSessionId && !state.graph) {
            elements.graphStage.innerHTML = '<div class="error-state">' + escapeHtml(state.error) + '</div>';
            elements.graphSummary.textContent = "";
            renderDetailsPanel();
            return;
          }

          if (!state.graph) {
            elements.graphStage.innerHTML = '<div class="empty-state">Choose a session to load its memory graph.</div>';
            elements.graphSummary.textContent = "";
            renderDetailsPanel();
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
            renderDetailsPanel();
            return;
          }

          elements.graphStage.innerHTML = renderGraphSvg(graph);
          elements.graphStage.querySelectorAll("[data-graph-node-id]").forEach((node) => {
            node.addEventListener("click", () => {
              selectGraphNode(node.getAttribute("data-graph-node-id"), graph);
              state.actionStatus = null;
              renderGraph();
            });
          });

          const selected = graph.nodes.find((node) => node.id === state.selectedGraphNodeId) || graph.nodes[0];
          if (selected && selected.id !== state.selectedGraphNodeId) selectGraphNode(selected.id, graph);
          renderDetailsPanel();
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

        function selectGraphNode(nodeId, graph) {
          if (!nodeId) return;
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          state.selectedGraphNodeId = nodeId;
          state.selectedEntity = node
            ? { kind: node.kind, id: node.id, source: "graph" }
            : null;
        }

        function renderDetailsPanel() {
          const node = resolveSelectedEntity();
          if (!node) {
            const noun = state.activeTab === "graph" ? "node in the graph" : "entity";
            elements.detailsPanel.innerHTML = '<p class="subtle">Select a ' + noun + ' to inspect its metadata.</p>';
            return;
          }

          renderEntityDetails(node);
        }

        function resolveSelectedEntity() {
          if (!state.selectedEntity) return null;
          const tables = normalizeTables(state.tables);

          if (state.selectedEntity.kind === "topic") {
            const raw = ((state.graph && state.graph.nodes) || []).find((node) => node.id === state.selectedEntity.id)
              || ((state.tables && state.tables.topics) || []).find((node) => node.id === state.selectedEntity.id);
            if (!raw) return null;
            return {
              id: raw.id,
              kind: "topic",
              title: raw.label || raw.id,
              subtitle: raw.summary || "",
              tags: raw.tags || [],
              lifecycle: raw.suppressed ? "suppressed" : "active",
              raw
            };
          }

          if (state.selectedEntity.kind === "memory") {
            const raw = ((state.graph && state.graph.memories) || []).find((memory) => memory.id === state.selectedEntity.id)
              || ((state.tables && state.tables.memories) || []).find((memory) => memory.id === state.selectedEntity.id);
            if (!raw) return null;
            return {
              id: raw.id,
              kind: "memory",
              title: raw.subject ? raw.subject + " " + raw.predicate : raw.id,
              subtitle: raw.value || "",
              tags: raw.tags || [],
              lifecycle: memoryLifecycle(raw),
              raw
            };
          }

          if (state.selectedEntity.kind === "segment") {
            return tables.segments.find((segment) => segment.id === state.selectedEntity.id) || null;
          }

          if (state.selectedEntity.kind === "message") {
            return tables.messages.find((message) => message.id === state.selectedEntity.id) || null;
          }

          return null;
        }

        function renderEntityDetails(node) {
          if (!node) {
            renderDetailsPanel();
            return;
          }

          elements.detailsPanel.innerHTML = node.kind === "topic"
            ? renderTopicDetails(node)
            : node.kind === "memory"
              ? renderMemoryDetails(node)
              : node.kind === "segment"
                ? renderSegmentDetails(node)
                : renderMessageDetails(node);

          elements.detailsPanel.querySelectorAll("[data-detail-node-id]").forEach((button) => {
            button.addEventListener("click", () => {
              const id = button.getAttribute("data-detail-node-id");
              const kind = ((state.graph && state.graph.nodes) || (state.tables && state.tables.topics) || []).some((topic) => topic.id === id) ? "topic" : "memory";
              state.selectedGraphNodeId = id;
              state.selectedEntity = { kind, id, source: state.activeTab === "tables" ? "tables" : "graph" };
              state.actionStatus = null;
              if (state.activeTab === "graph") {
                renderGraph();
              } else {
                renderWorkspace();
              }
            });
          });

          elements.detailsPanel.querySelectorAll("[data-lifecycle-action]").forEach((button) => {
            button.addEventListener("click", () => runLifecycleAction(node, button.getAttribute("data-lifecycle-action")));
          });
        }

        function renderTopicDetails(node) {
          const raw = node.raw || {};
          const connectedMemories = (((state.graph && state.graph.memories) || (state.tables && state.tables.memories) || [])).filter((memory) => memory.topicNodeId === node.id);
          const lifecycle = raw.suppressed
            ? "Suppressed" + (raw.suppressedAt ? " since " + formatDate(raw.suppressedAt) : "")
            : "Active";
          const sourceRows = [
            detailTextRow("Source", raw.source || "Not recorded"),
            detailTextRow("Segment", raw.segmentId || "Unknown"),
            detailTextRow("Message range", Array.isArray(raw.messageRange) ? raw.messageRange.join(" to ") : "Unknown"),
            detailTextRow("Agent", raw.agentId || "None"),
            detailTextRow("Fleet", raw.fleetId || "None")
          ].join("");

          return detailSection("Topic", [
            detailTextRow("Label", raw.label || node.title),
            detailTextRow("Summary", raw.summary || "None"),
            detailRow("Tags", tagsMarkup(node.tags)),
            detailTextRow("Lifecycle", lifecycle),
            detailTextRow("Topic order", raw.topicOrder == null ? "Unknown" : String(raw.topicOrder)),
            detailTextRow("Created", formatDate(raw.createdAt))
          ].join("")) +
          detailSection("Source metadata", sourceRows) +
          detailSection("Connected memories", connectedMemoriesMarkup(connectedMemories)) +
          renderActionSection(node);
        }

        function renderMemoryDetails(node) {
          const raw = node.raw || {};
          const lifecycleFlags = memoryLifecycleFlags(raw);
          const relationshipMarkup = state.graph ? memoryRelationshipsMarkup(node.id) : '<p class="subtle">Load the Graph tab to inspect memory relationships.</p>';

          return detailSection("Memory", [
            detailTextRow("Subject", raw.subject || "None"),
            detailTextRow("Predicate", raw.predicate || "None"),
            detailTextRow("Value", raw.value || "None"),
            detailTextRow("Confidence", raw.confidence == null ? "Unknown" : String(raw.confidence)),
            detailTextRow("Memory type", raw.memoryType || "Unknown"),
            detailTextRow("Source type", raw.sourceType || "Unknown"),
            detailRow("Tags", tagsMarkup(node.tags)),
            detailTextRow("Created", formatDate(raw.createdAt))
          ].join("")) +
          detailSection("Lifecycle", [
            detailRow("Flags", tagsMarkup(lifecycleFlags)),
            detailTextRow("Forgotten at", raw.forgottenAt ? formatDate(raw.forgottenAt) : "Not forgotten"),
            detailTextRow("Superseded by", raw.supersededBy || "None")
          ].join("")) +
          detailSection("Source metadata", [
            detailTextRow("Source", raw.source || "Not recorded"),
            detailTextRow("Title", raw.sourceTitle || "Not recorded"),
            detailTextRow("URL", raw.sourceUrl || "Not recorded"),
            detailTextRow("Topic node", raw.topicNodeId || "Unknown"),
            detailTextRow("Agent", raw.agentId || "None"),
            detailTextRow("Fleet", raw.fleetId || "None")
          ].join("")) +
          detailSection("Relationships", relationshipMarkup) +
          renderActionSection(node);
        }

        function renderSegmentDetails(node) {
          const raw = node.raw || {};
          const topics = (((state.graph && state.graph.nodes) || (state.tables && state.tables.topics) || [])).filter((topic) => topic.segmentId === node.id);

          return detailSection("Segment", [
            detailTextRow("ID", raw.id || node.id),
            detailTextRow("Order", raw.topicOrder == null ? "Unknown" : String(raw.topicOrder)),
            detailTextRow("Message range", formatSegmentRange(raw)),
            detailTextRow("Drift score", raw.driftScore == null ? "Unknown" : String(raw.driftScore)),
            detailTextRow("Created", formatDate(raw.createdAt)),
            detailTextRow("Related topics", String(topics.length))
          ].join("")) +
          detailSection("Related topics", connectedTopicsMarkup(topics));
        }

        function renderMessageDetails(node) {
          const raw = node.raw || {};
          const content = raw.content || "";
          const index = node.index == null ? messageIndexFromId(node.id) : node.index;
          const segment = (((state.tables && state.tables.segments) || [])).find((candidate) =>
            index != null && candidate.startIndex <= index && candidate.endIndex >= index
          );

          return detailSection("Message", [
            detailTextRow("Index", index == null ? "Unknown" : String(index)),
            detailTextRow("Role", raw.role || "Unknown"),
            detailTextRow("Approx length", numberText(content.length) + " chars"),
            detailTextRow("Related segment", segment ? segment.id : "None")
          ].join("")) +
          detailSection("Content", '<p class="detail-value">' + escapeHtml(content || "No content") + '</p>');
        }

        function renderActionSection(node) {
          const status = state.actionStatus && state.actionStatus.nodeId === node.id
            ? '<div class="action-status ' + state.actionStatus.kind + '" role="' + (state.actionStatus.kind === "error" ? "alert" : "status") + '" aria-live="polite">' + escapeHtml(state.actionStatus.message) + '</div>'
            : "";
          let action = "";

          if (node.kind === "topic" && !node.raw.suppressed) {
            action = '<button class="icon-button" type="button" data-lifecycle-action="suppress"' + (state.actionPending ? " disabled" : "") + '>Suppress topic</button>';
          }

          if (!action && !status) return "";
          return detailSection("Maintenance", status + (action ? '<div class="detail-actions">' + action + '</div>' : ""));
        }

        async function runLifecycleAction(node, action) {
          if (!state.selectedSessionId || state.actionPending) return;
          if (node.kind !== "topic" || action !== "suppress") return;

          const sessionId = state.selectedSessionId;
          const url = "/api/sessions/" + encodeURIComponent(sessionId) + "/nodes/" + encodeURIComponent(node.id) + "/suppress";
          state.actionPending = true;
          state.actionStatus = null;
          renderEntityDetails(node);

          try {
            const result = await fetchJson(url, { method: "POST" });
            state.actionStatus = {
              nodeId: node.id,
              kind: "success",
              message: lifecycleActionMessage(action, result.changed)
            };
            const refreshed = state.activeTab === "tables"
              ? await loadTables(sessionId, { force: true })
              : await loadGraph(sessionId, { preserveSelection: true });
            if (!refreshed) {
              state.actionStatus = {
                nodeId: node.id,
                kind: "error",
                message: "The lifecycle action completed, but the workspace could not be refreshed."
              };
            }
          } catch (error) {
            state.actionStatus = {
              nodeId: node.id,
              kind: "error",
              message: error.message || String(error)
            };
          } finally {
            state.actionPending = false;
            renderGraph();
          }
        }

        function lifecycleActionMessage(action, changed) {
          if (!changed) return "No change was needed; the lifecycle state was already up to date.";
          return "Topic suppressed. The graph and node details have been refreshed.";
        }

        function connectedMemoriesMarkup(memories) {
          if (memories.length === 0) return '<p class="subtle">No memories are connected to this topic.</p>';
          return '<ul class="detail-list">' + memories.map((memory) =>
            '<li><button class="detail-link" type="button" data-detail-node-id="' + escapeAttribute(memory.id) + '">' +
              escapeHtml(memory.subject + " " + memory.predicate + ": " + memory.value) +
            '</button></li>'
          ).join("") + '</ul>';
        }

        function connectedTopicsMarkup(topics) {
          if (topics.length === 0) return '<p class="subtle">No topics are connected to this segment.</p>';
          return '<ul class="detail-list">' + topics.map((topic) =>
            '<li><button class="detail-link" type="button" data-detail-node-id="' + escapeAttribute(topic.id) + '">' +
              escapeHtml((topic.label || topic.id) + (topic.summary ? ": " + truncate(topic.summary, 80) : "")) +
            '</button></li>'
          ).join("") + '</ul>';
        }

        function memoryRelationshipsMarkup(memoryId) {
          const edges = (state.graph.memoryEdges || []).filter((edge) => edge.sourceId === memoryId || edge.targetId === memoryId);
          if (edges.length === 0) return '<p class="subtle">No related, conflict, or update edges.</p>';

          return '<ul class="detail-list">' + edges.map((edge) => {
            const outgoing = edge.sourceId === memoryId;
            const relatedId = outgoing ? edge.targetId : edge.sourceId;
            const related = (state.graph.memories || []).find((memory) => memory.id === relatedId);
            const direction = outgoing ? "outgoing" : "incoming";
            const label = related ? related.subject + " " + related.predicate + ": " + related.value : relatedId;
            return '<li><span class="badge">' + escapeHtml(edge.edgeType || "related") + '</span> ' +
              '<span class="subtle">' + direction + '</span> ' +
              '<button class="detail-link" type="button" data-detail-node-id="' + escapeAttribute(relatedId) + '">' + escapeHtml(label) + '</button></li>';
          }).join("") + '</ul>';
        }

        function memoryLifecycleFlags(memory) {
          const flags = [];
          if (memory.forgotten) flags.push("forgotten");
          if (memory.decayed) flags.push("decayed");
          if (memory.hasConflict) flags.push("conflicting");
          if (memory.supersededBy) flags.push("superseded");
          return flags.length > 0 ? flags : ["active"];
        }

        function detailSection(title, content) {
          return '<section class="detail-section"><h2 class="detail-section-title">' + escapeHtml(title) + '</h2>' + content + '</section>';
        }

        function detailTextRow(label, value) {
          return detailRow(label, escapeHtml(value));
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

        function formatMessageRange(range) {
          return Array.isArray(range) ? range.join(" to ") : "Unknown";
        }

        function formatSegmentRange(segment) {
          if (segment.startIndex == null || segment.endIndex == null) return "Unknown";
          return String(segment.startIndex) + " to " + String(segment.endIndex);
        }

        function messageIndexFromId(id) {
          const match = String(id || "").match(/^message:(\\d+)$/);
          return match ? Number.parseInt(match[1], 10) : null;
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
