// Minimal SPA server mirroring vercel.json: static files, fallback to index.html
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const root = new URL("../dist/", import.meta.url).pathname;
const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".json":"application/json", ".map":"application/json" };
http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  for (const candidate of [join(root, path), join(root, "index.html")]) {
    try {
      const data = await readFile(candidate);
      res.writeHead(200, { "content-type": types[extname(candidate)] ?? "application/octet-stream" });
      res.end(data);
      return;
    } catch {}
  }
  res.writeHead(404); res.end("not found");
}).listen(8090, () => console.log("serving"));
