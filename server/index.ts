import dotenv from "dotenv";
import { createApp } from "./app.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const port = Number(process.env.PORT ?? 8837);
const app = await createApp();

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`FacetWrite API listening at http://127.0.0.1:${port}`);
});

server.on("error", (error) => {
  console.error("FacetWrite API failed to start", error);
  process.exitCode = 1;
});
