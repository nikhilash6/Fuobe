// Phone-width layout check: no route may scroll sideways at 390 px, in light and dark mode.
// Usage: node tests/e2e/no-horizontal-scroll.mjs [appUrl] [--light | --dark] [--routes=/a,/b]
//   (pnpm test:e2e:mobile; the app must be running, demo mode is fine). Exits 1 if any page is wider
//   than the screen or doesn't load.
//
// Every page under src/app/(studio) is visited, dynamic segments with samples from tests/e2e/_routes.mjs:
// every studio hub mode (/audio/music, /video-tools/join…), real ids (a cinema project, a canvas and an
// Assist project are created for the purpose) and unknown ids (their not-found pages must fit too),
// plus two demo Assist chats (an approval card, and results), /login and an unknown URL (the 404 page). A
// dynamic route without a sample is visited with "does-not-exist" for each segment, and named. For each route it
// asserts document.documentElement.scrollWidth === clientWidth once the page has rendered, and names
// the widest elements when it isn't. Pages that don't load are reported apart from layout failures.
import { launch, openRoute, PHONE, post, root } from "./_browser.mjs";
import { dynamicSamples, querySamples, studioRoutes } from "./_routes.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const schemes = args.includes("--dark") ? ["dark"] : args.includes("--light") ? ["light"] : ["light", "dark"];
const only = args.find((a) => a.startsWith("--routes="))?.slice(9).split(",").filter(Boolean);

/** Static routes from the file system, plus samples for the dynamic ones (hub modes, created ids, unknown ids). */
async function discoverRoutes() {
  const { routes: out } = studioRoutes(root);
  const project = await post(app, "/api/cinema/projects", { name: "Layout check" });
  const canvas = await post(app, "/api/canvases", { name: "Layout check" });
  const assistProject = await post(app, "/api/assist/projects", { name: "Layout check" });
  // Two demo chats: one waiting on its approval card, one that ran by itself (results in the chat).
  const brief = "4 product photos of a matte black perfume bottle on wet stone";
  const askFirst = await post(app, "/api/assist", { text: brief, engine: "cloud", mode: { mode: "free" } });
  const autoRun = await post(app, "/api/assist", { text: brief, engine: "cloud", autoApprove: true, mode: { mode: "free" } });
  const { urls, generated } = dynamicSamples(root, { cinema: project?.id, canvas: canvas?.id, assistProject: assistProject?.id });
  const chats = [askFirst?.id, autoRun?.id].filter(Boolean).map((id) => `/assist?c=${id}`);
  // A skill with a recipe: its Run form opens from /assist/skills?run=<name>.
  const recipeSkill = await recipeSkillSample();
  const samples = [...urls, ...chats, ...querySamples({ recipeSkill }), "/library?tab=favorites", "/login", "/this-page-does-not-exist"];
  if (!recipeSkill) console.log("note: couldn't create a sample skill with a recipe, only an unknown /assist/skills?run= is checked");
  if (!project?.id) console.log("note: couldn't create a sample cinema project, only an unknown /cinema/[id] is checked");
  if (!canvas?.id) console.log("note: couldn't create a sample canvas, only an unknown /canvas/[id] is checked");
  if (!assistProject?.id) console.log("note: couldn't create a sample Assist project, only an unknown /assist/projects/[id] is checked");
  if (chats.length < 2) console.log("note: couldn't start the sample Assist chats, so /assist?c=<id> isn't fully checked");
  for (const p of generated) console.log(`note: ${p} has no sample in tests/e2e/_routes.mjs: only its not-found page is checked`);
  return [...new Set([...out, ...samples])];
}

/** A user skill with a two-input recipe (a picture and a name), made for the check; its name, or null. */
async function recipeSkillSample() {
  const name = "layout-check-run";
  try {
    await fetch(`${app}/api/assist/skills/${name}`, { method: "DELETE" });
    await post(app, "/api/assist/skills", { name, title: "Layout check", description: "A poster from a product photo.", body: "# Poster" });
    const res = await fetch(`${app}/api/assist/skills/${name}/recipe`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fuobeRecipe: 1,
        params: [
          { id: "product", label: "Product photo", type: "image", required: true },
          { id: "name", label: "Product name with a long label to wrap", type: "text", required: true, example: "Lumen desk lamp" },
          { id: "shape", label: "Shape", type: "choice", options: ["1:1", "9:16", "16:9", "4:5", "3:4", "21:9"], default: "1:1" },
        ],
        steps: [{ key: "poster", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a plinth", inputs: { images: ["{{product}}"] }, params: { aspectRatio: "{{shape}}" } } }],
      }),
    });
    if (!res.ok) return null;
    await post(app, `/api/assist/skills/${name}/verify`, { level: "plan" });
    return name;
  } catch {
    return null;
  }
}

const routes = only ?? (await discoverRoutes());
const browser = await launch();
const wide = [];
const broken = [];
for (const scheme of schemes) {
  console.log(`\n${scheme} mode, 390 × 844`);
  const ctx = await browser.newContext({ ...PHONE, colorScheme: scheme });
  for (const route of routes) {
    const page = await ctx.newPage();
    try {
      await openRoute(page, app + route);
    } catch (e) {
      console.log(`LOAD ${route.padEnd(36)} ${e.message.split("\n")[0]}`);
      broken.push(`${route} (${scheme})`);
      await page.close();
      continue;
    }
    try {
      const r = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const culprits = [];
        const describe = (el, b) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 4).join(".")} (right ${Math.round(b.right)}px)`;
        if (document.documentElement.scrollWidth > W) {
          const sticking = [...document.querySelectorAll("body *")].map((el) => [el, el.getBoundingClientRect()]).filter(([, b]) => b.right > W + 1 && b.width);
          // Prefer elements not inside a scroller that itself fits (those are the real culprits).
          for (const [el, b] of sticking) {
            let contained = false;
            for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
              if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= W + 1) {
                contained = true;
                break;
              }
            }
            if (!contained) culprits.push(describe(el, b));
            if (culprits.length >= 5) break;
          }
          if (!culprits.length) for (const [el, b] of sticking.slice(0, 5)) culprits.push(describe(el, b));
        }
        return { scrollWidth: document.documentElement.scrollWidth, clientWidth: W, culprits };
      });
      const ok = r.scrollWidth === r.clientWidth;
      console.log(`${ok ? "ok  " : "WIDE"} ${route.padEnd(36)} ${r.scrollWidth}/${r.clientWidth}`);
      if (!ok) {
        for (const c of r.culprits) console.log(`       ${c}`);
        wide.push(`${route} (${scheme})`);
      }
    } catch (e) {
      console.log(`LOAD ${route.padEnd(36)} ${e.message.split("\n")[0]}`);
      broken.push(`${route} (${scheme})`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();
// The sample skill would stand in for "No skills of your own yet" in the Assist flows: it goes again.
if (!only) await fetch(`${app}/api/assist/skills/layout-check-run`, { method: "DELETE" }).catch(() => {});
const checks = routes.length * schemes.length;
console.log("");
if (wide.length) console.log(`${wide.length} of ${checks} pages scroll sideways at 390 px: ${wide.join(", ")}`);
if (broken.length) console.log(`${broken.length} of ${checks} pages didn't load: ${broken.join(", ")}`);
if (!wide.length && !broken.length) console.log(`All ${routes.length} routes fit 390 px (${schemes.join(" and ")}).`);
process.exit(wide.length || broken.length ? 1 : 0);
