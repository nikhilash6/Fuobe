import { ImageResponse } from "next/og";
import { connection } from "next/server";
import sharp from "sharp";
import { readSharedPicture } from "@/server/chat/files";
import { findChatShare } from "@/server/chat/store";

export const alt = "A chat shared from Fuobe";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The plain words of a message for a preview (no markdown marks, one paragraph). */
const plain = (s: string, n: number) => {
  const t = s
    .replace(/[*#_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

async function portraitUri(ref: string | null): Promise<string | null> {
  if (!ref) return null;
  const pic = await readSharedPicture(ref);
  if (!pic) return null;
  const jpeg = await sharp(pic.data).rotate().resize(520, 630, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer().catch(() => null);
  return jpeg ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : null;
}

/**
 * The link preview of a shared chat: the character's portrait (or their colours) and the opening of the chat. A
 * Mango Chilli chat shows only its title and an 18+ mark, never its words.
 */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const s = findChatShare(token);
  const snap = s?.snapshot;
  const [a, b] = snap?.character?.accent ?? ["#1d1640", "#6a5ee7"];
  const portrait = snap && !snap.mature ? await portraitUri(s.portrait) : null;
  const name = snap?.character?.name ?? snap?.label ?? "Fuobe Chat";
  const lines = snap && !snap.mature ? snap.messages.filter((m) => m.content.trim()).slice(0, 3) : [];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`, color: "white" }}>
        {portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={portrait} width={520} height={630} style={{ objectFit: "cover" }} alt="" />
        ) : (
          <div style={{ width: 420, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 220, fontWeight: 700, opacity: 0.9 }}>{name.slice(0, 1).toUpperCase()}</div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 60px", background: "rgba(8,6,16,0.55)" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 26, opacity: 0.75, display: "flex" }}>{snap?.mature ? "Mango Chilli · 18+" : "A chat on Fuobe"}</div>
            <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05, marginTop: 10, display: "flex" }}>{plain(name, 40)}</div>
            {snap?.character?.tagline && !snap.mature ? <div style={{ fontSize: 26, opacity: 0.8, marginTop: 10, display: "flex" }}>{plain(snap.character.tagline, 80)}</div> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {lines.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: 560,
                  fontSize: 24,
                  lineHeight: 1.35,
                  padding: "12px 18px",
                  borderRadius: 18,
                  background: m.role === "user" ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.14)",
                  color: m.role === "user" ? "#17121f" : "white",
                }}
              >
                {plain(m.content, 120)}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 24, opacity: 0.8, display: "flex" }}>fuobe.com</div>
        </div>
      </div>
    ),
    size,
  );
}
