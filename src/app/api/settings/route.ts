import { connection } from "next/server";
import { forgetComputer } from "@/server/computer/tasks";
import { getSetting, publicSettings, setSetting, SETTINGS, validateSetting, type SettingName } from "@/server/settings";

export async function GET() {
  await connection();
  // allowPrivate (FUOBE_ALLOW_PRIVATE_URLS): a hosted page may send a private address (a VPN such as Tailscale) to test.
  return Response.json({ settings: publicSettings(), allowPrivate: process.env.FUOBE_ALLOW_PRIVATE_URLS === "1" });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const entries = Object.entries(body).filter(([name, value]) => name in SETTINGS && typeof value === "string") as [SettingName, string][];
  try {
    entries.forEach(([name, value]) => validateSetting(name, value.trim()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const onComputer = getSetting("comfyWhere") === "computer";
  for (const [name, value] of entries) setSetting(name, value.trim());
  // ComfyUI no longer runs on the owner's computer: the runs still going there stop, saying why (Disconnect, or a move).
  const disconnected = new URL(request.url).searchParams.get("why") === "disconnected";
  if (onComputer && getSetting("comfyWhere") !== "computer") forgetComputer("owner", disconnected ? "disconnected" : "switched");
  return Response.json({ settings: publicSettings() });
}
