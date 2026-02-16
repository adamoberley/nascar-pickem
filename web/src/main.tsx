import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/app.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

function Bootstrap() {
  const [App, setApp] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    import("./App")
      .then((m) => setApp(() => m.default))
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if (error) {
    return (
      <main
        style={{
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          maxWidth: "560px",
          margin: "0 auto",
          color: "#111",
        }}
      >
        <h1 style={{ color: "#a81f32" }}>Something went wrong</h1>
        <pre
          style={{
            background: "#f0f2f5",
            padding: "1rem",
            overflow: "auto",
            fontSize: "14px",
            whiteSpace: "pre-wrap",
          }}
        >
          {error.message}
        </pre>
        {error.stack ? (
          <details style={{ marginTop: "1rem" }}>
            <summary>Stack</summary>
            <pre style={{ fontSize: "12px", overflow: "auto" }}>{error.stack}</pre>
          </details>
        ) : null}
        <p>Fix the issue above and refresh.</p>
      </main>
    );
  }

  if (!App) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui", textAlign: "center" }}>
        Loading…
      </main>
    );
  }

  return <App />;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

function showError(el: HTMLElement, msg: string, detail?: string) {
  el.innerHTML = `
    <main style="padding:2rem;font-family:system-ui;max-width:560px;margin:0 auto;color:#111">
      <h1 style="color:#a81f32">Something went wrong</h1>
      <pre style="background:#f0f2f5;padding:1rem;overflow:auto;font-size:14px;white-space:pre-wrap">${msg}</pre>
      ${detail ? `<pre style="font-size:12px;margin-top:1rem">${detail}</pre>` : ""}
      <p>Fix the issue and refresh.</p>
    </main>
  `;
}

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <Bootstrap />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} catch (err) {
  showError(
    rootEl,
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? err.stack : undefined,
  );
}
