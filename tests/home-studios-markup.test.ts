import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Home's "Studios and tools" section is the pattern every area page (/create, /studios…) repeats. The area pages share
 * its component, and Home must look exactly as it did: its markup is pinned here.
 */

vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { StudiosSection } = await import("@/components/home/home-sections");
const { homeShowcase } = await import("@/lib/home-showcase");

const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node));

describe("Home's Studios and tools", () => {
  it("renders the same markup as before the area pages shared it", async () => {
    const home = await homeShowcase();
    const html = render(createElement(StudiosSection, { facts: home.facts, studios: home.studios, audioTools: home.audioTools, pills: home.pills }));
    await expect(html.replace(/></g, ">\n<")).toMatchFileSnapshot("__snapshots__/home-studios.html");
  });
});
