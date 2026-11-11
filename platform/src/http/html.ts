// Response helpers for the browser pages.

export function html(status: number, title: string, body: string): Response {
  const document = `<!doctype html><meta charset="utf-8"><title>${escape(title)} · Totem</title><h1>${escape(title)}</h1>${body}`;
  return new Response(document, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
