import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { namedImageSlots, slotMessage } from "@/lib/composer";
import { EDIT_STUDIO, FOLEY_STUDIO, IMAGE_STUDIO, MUSIC_STUDIO, SFX_STUDIO } from "@/lib/studios";
import { studioCatalog } from "@/lib/studio-catalog";

describe("named image slots (try-on)", () => {
  it("labels the Edit studio's image and reference tile with the model's image names", () => {
    const names = getModel("fashn-tryon")!.options.imageLabels;
    const r = namedImageSlots(EDIT_STUDIO.slots, names, EDIT_STUDIO.multiRef?.label);
    expect(r.slots.map((s) => s.label)).toEqual(["Person photo"]);
    expect(r.refLabel).toBe("Add garment");
    expect(slotMessage(r.slots[0].label)).toBe("Add a person photo");
    // Once the garment is in, the tile goes back to its own label (FASHN takes no more images anyway).
    expect(namedImageSlots(EDIT_STUDIO.slots, names, EDIT_STUDIO.multiRef?.label, 1).refLabel).toBe("Add ref");
    // Models without names keep the studio's own labels, same array.
    const same = namedImageSlots(EDIT_STUDIO.slots, getModel("nano-banana-pro")!.options.imageLabels, "Add ref");
    expect(same.slots).toBe(EDIT_STUDIO.slots);
    expect(same.refLabel).toBe("Add ref");
  });
});

describe("studio pickers and defaults", () => {
  it("the Image studio lists text-to-image models; edit-only tools are in Edit", () => {
    const image = studioCatalog(IMAGE_STUDIO).models.map((m) => m.id);
    const edit = studioCatalog(EDIT_STUDIO).models.map((m) => m.id);
    for (const id of ["fashn-tryon", "bria-product-shot", "qwen-multiple-angles", "krea-2-style", "recraft-4-style"]) {
      expect(image, id).not.toContain(id);
      expect(edit, id).toContain(id);
    }
    expect(image).toEqual(expect.arrayContaining(["nano-banana-pro", "recraft-4-1-pro", "ideogram-3", "oss-z-image-turbo"]));
  });

  it("Audio studios open on the models the parity studio uses", () => {
    expect(SFX_STUDIO.defaultModels.cloud).toBe("mirelo-sfx-2");
    expect(MUSIC_STUDIO.defaultModels.cloud).toBe("sonilo-music");
    expect(FOLEY_STUDIO.defaultModels.cloud).toBe("mirelo-sfx-2-video");
    for (const s of [SFX_STUDIO, MUSIC_STUDIO, FOLEY_STUDIO]) expect(studioCatalog(s).models.map((m) => m.id)).toContain(s.defaultModels.cloud);
  });
});
