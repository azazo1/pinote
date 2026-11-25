import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MainApp from "./MainApp";
import ShelfApp from "./ShelfApp";
import UpdateApp from "./components/UpdateApp";
import "./styles.css";
import "./main-window.css";
import "./settings.css";
import "./update-window.css";

const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {view === "main"
      ? <MainApp />
      : view === "shelf"
        ? <ShelfApp />
        : view === "update"
          ? <UpdateApp />
          : <App />}
  </React.StrictMode>,
);
