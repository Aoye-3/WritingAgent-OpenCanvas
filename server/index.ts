import dotenv from "dotenv";
import { createApp } from "./app.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const port = Number(process.env.PORT ?? 8787);
const app = await createApp();

app.listen(port, "127.0.0.1", () => {
  console.log(`FacetWrite API listening at http://127.0.0.1:${port}`);
});
