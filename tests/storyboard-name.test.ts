import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

const dir = tempDir("fuobe-storyboard-name-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createStoryboard, createStoryboardFilm } = await import("@/server/storyboard");
const { boardTitle } = await import("@/lib/storyboard-board");

beforeAll(() => {
  setSetting("demoMode", "auto");
  // No prompt LLM: the story is split by the offline shot list.
  setSetting("enhanceProvider", "none");
});

const batchTitle = (id: string) => (gens.getGeneration(id)!.request as { batchTitle?: string }).batchTitle;

describe("storyboard name on the server (U14)", () => {
  it("stores the idea on every frame, so any browser titles the board with it", async () => {
    const idea = "a lighthouse keeper finds a glowing bottle and follows its map into the sea";
    const board = await createStoryboard({ engine: "open", story: idea, frames: 3 });
    expect(board.items).toHaveLength(3);
    for (const g of board.items) expect(batchTitle(g.id)).toBe(idea);
    // A fresh browser has nothing remembered: the stored name still wins over the first scene.
    const frames = board.items.map((g) => gens.getGeneration(g.id)!);
    expect(boardTitle(frames, null)).toBe("A lighthouse keeper finds a glowing bottle and follows its map into the sea");
  });

  it("names a hand-written board after its first scene, and its film after the board", async () => {
    const board = await createStoryboard({ engine: "open", scenes: ["A fox wakes in the snow", "It follows a trail", "The trail ends at a cabin"] });
    expect(batchTitle(board.items[2].id)).toBe("A fox wakes in the snow");
    const { items } = createStoryboardFilm(board.batchId);
    const [film, ...clips] = items;
    for (const c of clips) expect(batchTitle(c.id)).toBe("A fox wakes in the snow");
    expect(film.prompt ?? film.request.prompt).toBe("A fox wakes in the snow");
  });
});
