// Fuobe Connect in ComfyUI's page: a setting for the studios that may use this ComfyUI, and "Connect to Fuobe"
// (pairing: a short code you approve on the studio, for Safari, phones and PCs with no screen).
import { app } from "../../scripts/app.js";

const get = async () => (await fetch("/fuobe/connect", { cache: "no-store" })).json();
const post = async (path, body) => {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(node.style, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

let dialog = null;
let timer = null;

function close() {
  clearInterval(timer);
  timer = null;
  dialog?.remove();
  dialog = null;
}

function render(box, s) {
  box.replaceChildren();
  const line = (text, style = {}) => box.append(el("p", { style: { margin: "0 0 10px", ...style } }, text));
  const button = (label, onclick, primary) =>
    el(
      "button",
      {
        onclick,
        style: {
          marginRight: "8px",
          padding: "6px 12px",
          borderRadius: "6px",
          border: "1px solid #666",
          cursor: "pointer",
          background: primary ? "#2563eb" : "transparent",
          color: primary ? "#fff" : "inherit",
        },
      },
      label,
    );
  if (s.paired && s.state !== "unpaired") {
    line(`Connected to ${s.paired.site}.`, { fontWeight: "600" });
    line(s.state === "connected" ? "Your Fuobe jobs run on this ComfyUI, even with no Fuobe tab open." : s.message || "Waiting for the studio…");
    box.append(
      button("Disconnect", async () => {
        await post("/fuobe/connect/unpair");
        render(box, await get());
      }),
      button("Close", close),
    );
    return;
  }
  if (s.state === "pairing" && s.pairing) {
    line("Approve this code on Fuobe, signed in:");
    box.append(el("p", { style: { fontSize: "28px", letterSpacing: "4px", fontFamily: "monospace", margin: "4px 0 12px" } }, s.pairing.code));
    box.append(button("Open Fuobe to approve", () => window.open(s.pairing.url, "_blank", "noopener"), true), button("Cancel", async () => {
      await post("/fuobe/connect/unpair");
      close();
    }));
    line(`Or open ${s.pairing.url} on any device.`, { marginTop: "10px", fontSize: "12px", opacity: "0.75" });
    return;
  }
  line("Run your Fuobe jobs on this ComfyUI, with no browser tab open. Useful for Safari, phones and PCs with no screen.");
  if (s.message) line(s.message, { fontSize: "12px", opacity: "0.75" });
  const site = s.studios?.[0] ?? "https://fuobe.com";
  box.append(
    button(`Connect to ${new URL(site).host}`, async (e) => {
      e.target.disabled = true;
      try {
        render(box, await post("/fuobe/connect/pair", { site }));
      } catch (err) {
        render(box, { ...s, message: String(err.message || err) });
      }
    }, true),
    button("Close", close),
  );
}

async function open() {
  close();
  const box = el("div", {});
  dialog = el(
    "div",
    {
      role: "dialog",
      "aria-label": "Fuobe Connect",
      style: { position: "fixed", top: "80px", right: "24px", zIndex: "10000", width: "360px", maxWidth: "calc(100vw - 48px)", padding: "16px", borderRadius: "10px", background: "var(--comfy-menu-bg, #222)", color: "var(--fg-color, #ddd)", boxShadow: "0 8px 30px rgba(0,0,0,.4)", font: "14px system-ui, sans-serif" },
    },
    el("p", { style: { margin: "0 0 10px", fontWeight: "700" } }, "Fuobe Connect"),
    box,
  );
  document.body.append(dialog);
  render(box, await get());
  timer = setInterval(async () => dialog && render(box, await get()), 2000);
}

app.registerExtension({
  name: "Fuobe.Connect",
  settings: [
    {
      id: "FuobeConnect.Studios",
      category: ["Fuobe Connect", "Studios", "Studios"],
      name: "Fuobe studios that may use this ComfyUI",
      tooltip: "Their pages may use this ComfyUI from your browser (to run their jobs). Separate several with commas. Every other website stays out.",
      type: "text",
      defaultValue: "https://fuobe.com",
      onChange: (value, old) => {
        if (old === undefined || value === old) return;
        post("/fuobe/connect/studios", { studios: value }).catch((e) => console.warn("[Fuobe Connect]", e));
      },
    },
  ],
  commands: [{ id: "FuobeConnect.Open", label: "Connect to Fuobe", icon: "pi pi-link", function: open }],
  menuCommands: [{ path: ["Extensions"], commands: ["FuobeConnect.Open"] }],
});
