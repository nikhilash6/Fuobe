import { packMenu } from "@/lib/mega-menus";
import { SERVER_MENUS } from "@/lib/mega-menus.server";

/**
 * The bar's motions menu as data (src/lib/mega-menus.server.ts): read from the catalog and the covers at build time and
 * served as a static file, fetched the first time the menu warms (src/components/nav/mega-data.ts).
 */
export function GET() {
  return Response.json(packMenu(SERVER_MENUS.motions()));
}
