import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WeaveRoot from "./WeaveRoot";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WeaveRoot />
  </StrictMode>,
);
