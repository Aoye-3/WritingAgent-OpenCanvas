import dotenv from "dotenv";
import { createApp } from "./app.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const port = Number(process.env.PORT ?? 8837);
const host = process.env.FACETWRITE_API_HOST?.trim() || process.env.HOST?.trim() || "127.0.0.1";
const app = await createApp();

const server = app.listen(port, host, () => {
  console.log(`FacetWrite API listening at http://${host}:${port}`);
});

server.on("error", (error) => {
  console.error("FacetWrite API failed to start", error);
  process.exitCode = 1;
});
