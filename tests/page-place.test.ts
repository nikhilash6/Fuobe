import { describe, expect, it } from "vitest";
import { addressHost, addressKind, hostKind, ownerSteer, pagePlace, refusedLine, refusedOnHosted } from "@/lib/page-place";

describe("where the page is (its own hostname)", () => {
  it("on the server's machine: localhost, *.localhost, 127/8 and ::1", () => {
    for (const h of ["localhost", "a.localhost", "127.0.0.1", "127.0.0.2", "[::1]", "::1", "LOCALHOST", "localhost."]) expect(pagePlace(h), h).toBe("here");
  });
  it("on its network: private and link-local literals, CGNAT, ULA, single-label and LAN names", () => {
    for (const h of ["192.168.1.10", "10.1.2.3", "172.16.0.9", "100.101.102.103", "169.254.1.1", "[fd00::1]", "[fe80::1]", "studio", "nas.lan", "x.home.arpa", "box.local", "pc.internal", "pc.localdomain"])
      expect(pagePlace(h), h).toBe("network");
  });
  it("hosted: a public name or a public address, in any case and with a trailing dot", () => {
    for (const h of ["fuobe.com", "FUOBE.COM", "fuobe.com.", "studio.test", "203.0.113.9", "[2001:db8::1]"]) expect(pagePlace(h), h).toBe("hosted");
  });
});

describe("what a typed ComfyUI address means to a server", () => {
  const cases: [string, ReturnType<typeof addressKind>][] = [
    ["http://127.0.0.1:8188", "loopback"],
    ["127.0.0.1:8188", "loopback"],
    ["http://localhost:8188/", "loopback"],
    ["localhost:3399", "loopback"],
    ["http://comfy.localhost:8188", "loopback"],
    ["http://0.0.0.0:8188", "loopback"],
    ["http://[::1]:8188", "loopback"],
    ["http://[::]:8188", "loopback"],
    ["http://[::ffff:127.0.0.1]:8188", "loopback"],
    ["HTTP://LOCALHOST:8188", "loopback"],
    ["http://10.255.255.1:3399", "private"],
    ["http://172.20.1.1", "private"],
    ["http://192.168.1.5:8188/api", "private"],
    ["http://100.101.102.103:8188", "private"],
    ["http://[fd00::1]:8188", "private"],
    ["http://[::ffff:10.0.0.5]", "private"],
    ["http://169.254.169.254", "link-local"],
    ["http://169.254.0.1:3399", "link-local"],
    ["http://[fe80::1]:8188", "link-local"],
    ["http://nas.local:3399", "local-name"],
    ["http://studio:8188", "local-name"],
    ["http://box.lan.", "local-name"],
    ["https://abc.trycloudflare.com", "public"],
    ["https://gpu.example.com:8443/comfy", "public"],
    ["http://203.0.113.9:8188", "public"],
    ["http://172.32.0.1", "public"],
    ["http://100.128.0.1", "public"],
    ["ftp://example.com", "invalid"],
    ["not an address at all", "invalid"],
    ["http://", "invalid"],
    ["", "invalid"],
  ];
  it.each(cases)("%s is %s", (url, kind) => expect(addressKind(url)).toBe(kind));

  it("names the host as the sentence shows it", () => {
    expect(addressHost("http://127.0.0.1:8188/x")).toBe("127.0.0.1");
    expect(addressHost("localhost:3399")).toBe("localhost");
    expect(addressHost("http://[::1]:8188")).toBe("[::1]");
    expect(addressHost("nope nope")).toBe("");
  });

  it("is the same for a bare host", () => {
    expect(hostKind("127.0.0.1")).toBe("loopback");
    expect(hostKind("[fe80::1]")).toBe("link-local");
    expect(hostKind("gpu.example.com")).toBe("public");
  });
});

describe("what a hosted page never sends", () => {
  it("loopback and link-local always; private and LAN names unless the server allows private addresses", () => {
    expect(refusedOnHosted("loopback", false)).toBe(true);
    expect(refusedOnHosted("loopback", true)).toBe(true);
    expect(refusedOnHosted("link-local", true)).toBe(true);
    expect(refusedOnHosted("private", false)).toBe(true);
    expect(refusedOnHosted("private", true)).toBe(false);
    expect(refusedOnHosted("local-name", false)).toBe(true);
    expect(refusedOnHosted("local-name", true)).toBe(false);
    expect(refusedOnHosted("public", false)).toBe(false);
    expect(refusedOnHosted("invalid", false)).toBe(false);
  });

  it("says what the address means here, in one line", () => {
    expect(refusedLine("loopback", "127.0.0.1")).toBe("On this website, 127.0.0.1 is Fuobe's server, not your computer.");
    expect(refusedLine("private", "10.0.0.5")).toBe("10.0.0.5 is on your own network, which Fuobe's server can't reach.");
    expect(refusedLine("local-name", "nas.local")).toBe("nas.local is on your own network, which Fuobe's server can't reach.");
  });
});

describe("how the owner's GPU is offered", () => {
  const off = { engineMode: "open", providers: { comfyui: { configured: false } } };
  const on = { engineMode: "open", providers: { comfyui: { configured: true } } };
  it("ComfyUI on the owner's computer, wherever the page is", () => {
    expect(ownerSteer("hosted", off, "computer")).toBe("computer");
    expect(ownerSteer("here", on, "computer")).toBe("computer");
  });
  it("a connected server ComfyUI wins, wherever the page is", () => {
    expect(ownerSteer("hosted", on, "server")).toBe("server");
    expect(ownerSteer("here", on, "server")).toBe("server");
  });
  it("hosted with nothing connected: the computer first; local: as before", () => {
    expect(ownerSteer("hosted", off, "server")).toBe("hosted");
    expect(ownerSteer("here", off, "server")).toBe("local");
    expect(ownerSteer("network", off, "server")).toBe("local");
    expect(ownerSteer("hosted", { ...off, engineMode: "cloud" }, "server")).toBe("local");
  });
  it("unknown until the page and the status are", () => {
    expect(ownerSteer(null, off, "server")).toBeNull();
    expect(ownerSteer("hosted", undefined, "server")).toBeNull();
  });
});
