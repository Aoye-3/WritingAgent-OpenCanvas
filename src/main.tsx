import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import { App } from "./app/App";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme accentColor="blue" grayColor="slate" radius="large" scaling="100%">
      <App />
    </Theme>
  </StrictMode>
);
