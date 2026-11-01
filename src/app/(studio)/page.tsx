import {
  AppsSection,
  AssistSection,
  EffectsSection,
  HomeFooter,
  MotionsSection,
  OpenSourceSection,
  ShowcaseWall,
  StartSection,
  StudiosSection,
} from "@/components/home/home-sections";
import { HomeView } from "@/components/home-view";
import { ASSIST_SUGGESTIONS } from "@/lib/assist";
import { HOME_TRY, homeShowcase, roundedDown } from "@/lib/home-showcase";
import { startQuotes, starterPriceLine } from "@/lib/starter-prices";

/**
 * The catalog stays on the server: Home gets slim cards, the numbers it quotes (each computed, lib/home-showcase.ts),
 * and what Start and the first-run guide cost. The sections under the wall are server components.
 */
export default async function Page() {
  const home = await homeShowcase();
  return (
    <HomeView
      openModels={roundedDown(home.facts.openModels)}
      chips={HOME_TRY}
      assist={{ label: "Plan a perfume ad with Assist", href: `/assist?prompt=${encodeURIComponent(ASSIST_SUGGESTIONS[0])}` }}
      wall={<ShowcaseWall wall={home.wall} />}
      prices={starterPriceLine()}
      quotes={startQuotes()}
    >
      <EffectsSection facts={home.facts} effects={home.effects} />
      <MotionsSection facts={home.facts} motions={home.motions} />
      <AppsSection facts={home.facts} beforeAfter={home.beforeAfter} reveals={home.reveals} />
      <StudiosSection facts={home.facts} studios={home.studios} audioTools={home.audioTools} pills={home.pills} />
      <AssistSection facts={home.facts} runsOn={home.runsOn} skills={home.skills} />
      <OpenSourceSection facts={home.facts} newModels={home.newModels} />
      <StartSection />
      <HomeFooter />
    </HomeView>
  );
}
