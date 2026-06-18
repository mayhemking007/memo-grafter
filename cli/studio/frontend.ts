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
        background: #f7f8fb;
        color: #1c2430;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
      }

      .app {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr);
      }

      .sidebar {
        border-right: 1px solid #d8dde8;
        background: #ffffff;
        padding: 24px 18px;
      }

      .brand {
        font-size: 18px;
        font-weight: 700;
        margin: 0 0 28px;
      }

      .nav {
        display: grid;
        gap: 8px;
      }

      .nav button {
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #445166;
        cursor: default;
        font: inherit;
        padding: 10px 12px;
        text-align: left;
      }

      .nav button[aria-current="page"] {
        background: #e7f0ff;
        color: #174a8b;
        font-weight: 650;
      }

      .main {
        min-width: 0;
        padding: 28px;
      }

      .topbar {
        align-items: center;
        display: flex;
        gap: 16px;
        justify-content: space-between;
        margin-bottom: 22px;
      }

      h1 {
        font-size: 24px;
        line-height: 1.2;
        margin: 0;
      }

      .url {
        color: #59677c;
        font-size: 13px;
      }

      .stats {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(2, minmax(160px, 1fr));
        margin-bottom: 24px;
      }

      .stat,
      .panel {
        background: #ffffff;
        border: 1px solid #d8dde8;
        border-radius: 8px;
      }

      .stat {
        padding: 18px;
      }

      .label {
        color: #68758a;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .value {
        font-size: 28px;
        font-weight: 750;
        margin-top: 8px;
      }

      .status {
        align-items: center;
        display: inline-flex;
        gap: 8px;
      }

      .dot {
        background: #17a46b;
        border-radius: 999px;
        display: inline-block;
        height: 10px;
        width: 10px;
      }

      .panel {
        min-height: 300px;
        padding: 20px;
      }

      .panel h2 {
        font-size: 16px;
        margin: 0 0 12px;
      }

      .empty {
        color: #68758a;
        line-height: 1.6;
        margin: 0;
        max-width: 680px;
      }

      @media (max-width: 760px) {
        .app {
          grid-template-columns: 1fr;
        }

        .sidebar {
          border-bottom: 1px solid #d8dde8;
          border-right: 0;
        }

        .stats {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <aside class="sidebar">
        <p class="brand">MemoGrafter Studio</p>
        <nav class="nav" aria-label="Studio sections">
          <button aria-current="page">Overview</button>
          <button>Sessions</button>
          <button>Memories</button>
          <button>Graph</button>
          <button>Lifecycle</button>
        </nav>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <h1>Memory Graph Overview</h1>
            <div class="url" id="studio-url"></div>
          </div>
        </div>
        <section class="stats" aria-label="Studio status">
          <div class="stat">
            <div class="label">Database</div>
            <div class="value status"><span class="dot"></span><span id="database-status"></span></div>
          </div>
          <div class="stat">
            <div class="label">Sessions</div>
            <div class="value" id="session-count"></div>
          </div>
        </section>
        <section class="panel">
          <h2>Studio shell</h2>
          <p class="empty">The local Studio host is running. Session, memory, graph, and lifecycle inspection views will be added in follow-up work.</p>
        </section>
      </main>
    </div>
    <script type="application/json" id="studio-state">${serializedState}</script>
    <script>
      const state = JSON.parse(document.getElementById("studio-state").textContent);
      document.getElementById("studio-url").textContent = state.studioUrl;
      document.getElementById("database-status").textContent = state.databaseStatus;
      document.getElementById("session-count").textContent = String(state.sessionCount);
    </script>
  </body>
</html>`;
}
