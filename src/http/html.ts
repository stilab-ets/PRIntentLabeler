export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — PRIntentLabeler</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      background: #0d1117;
      color: #e6edf3;
    }
    body { margin: 0; padding: 32px 16px; }
    main { max-width: 760px; margin: 0 auto; }
    .card {
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 24px;
      background: #161b22;
      margin-bottom: 18px;
    }
    h1 { font-size: 1.6rem; margin: 0 0 8px; }
    h2 { font-size: 1.1rem; margin-top: 0; }
    p { color: #b1bac4; }
    label { display: block; font-weight: 600; margin: 18px 0 6px; }
    input, select {
      box-sizing: border-box;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #484f58;
      border-radius: 6px;
      background: #0d1117;
      color: #e6edf3;
      font: inherit;
    }
    small { display: block; color: #8c959f; margin-top: 5px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    button, .button {
      border: 1px solid rgba(240, 246, 252, 0.1);
      border-radius: 6px;
      padding: 9px 16px;
      background: #238636;
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
    button.secondary, .button.secondary { background: #21262d; }
    button.danger { background: #da3633; }
    .notice {
      border-left: 4px solid #2f81f7;
      background: rgba(47, 129, 247, 0.12);
      padding: 12px 14px;
      margin: 16px 0;
    }
    .notice.error {
      border-color: #f85149;
      background: rgba(248, 81, 73, 0.12);
    }
    .notice.success {
      border-color: #3fb950;
      background: rgba(63, 185, 80, 0.12);
    }
    .muted { color: #8c959f; }
    code { background: #0d1117; padding: 2px 5px; border-radius: 4px; }
    ul.installations { list-style: none; padding: 0; }
    ul.installations li { margin: 10px 0; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

export function renderErrorPage(message: string, status = 400): string {
  return renderPage(
    `Erreur ${status}`,
    `<section class="card">
      <h1>Configuration indisponible</h1>
      <div class="notice error">${escapeHtml(message)}</div>
      <a class="button secondary" href="/settings">Retour aux configurations</a>
    </section>`,
  );
}
