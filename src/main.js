import "./styles.css";
import { init } from "./ui/app.js";

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
