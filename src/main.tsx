import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ShelfApp from "./ShelfApp";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {view === "shelf" ? <ShelfApp /> : <App />}
  </React.StrictMode>,
);
