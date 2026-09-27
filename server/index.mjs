import { createServer } from "node:http";
import { resolve } from "node:path";
import { createKtvApp } from "./app.mjs";
import { KtvStore } from "./store.mjs";

const port = Number(process.env.PORT || 8091);
const host = process.env.HOST || "0.0.0.0";
const dbPath = resolve(process.env.DB_PATH || "./data/openktv.db");
const mediaDir = resolve(process.env.MEDIA_DIR || "./data/media");
const store = new KtvStore({ dbPath, mediaDir });
const app = createKtvApp(store);
const server = createServer(app.handler);
server.on("upgrade", app.upgrade);
server.listen(port, host, () => console.log(`OpenKTV backend ready on http://${host}:${port}`));

function shutdown() {
  server.close(() => {
    app.close();
    store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
