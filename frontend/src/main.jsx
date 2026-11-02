import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "./app.css";
import App from "./App.jsx";

// Stahlblau (Pressen) + Bernstein (UBC / geschmolzenes Aluminium)
const theme = createTheme({
  primaryColor: "stahl",
  primaryShade: { light: 7, dark: 5 },
  colors: {
    stahl: ["#EEF4F8", "#DCE7EF", "#B6CDDD", "#8DB1CB", "#6A98BA", "#4F83AA", "#3E7099", "#2B5874", "#21465D", "#163345"],
    bernstein: ["#FFF6E6", "#FDEBC9", "#F9D592", "#F5BE58", "#F0AA2E", "#E39A2D", "#C98318", "#A86A0F", "#86530B", "#633C06"]
  },
  fontFamily: "Bahnschrift, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  headings: { fontFamily: "Bahnschrift, 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif", fontWeight: "600" },
  defaultRadius: "md",
  cursorType: "pointer"
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </React.StrictMode>
);
