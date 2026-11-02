import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { FUOBE_REPO } from "@/lib/connections";

export const metadata: Metadata = { title: "Terms", description: "The few rules for using Fuobe." };

export default function Page() {
  return (
    <LegalPage title="Terms" lead="The few rules for using Fuobe." updated="1 November 2026">
      <LegalSection title="Using Fuobe">
        <p>Fuobe is a free, open-source creative studio. Use it to make things, within the law and with respect for other people.</p>
      </LegalSection>
      <LegalSection title="What you upload">
        <p>
          Upload only what you have the right to use. Don&apos;t upload or make anything illegal, anything that sexualises minors, or anything that shows a
          real person in a way they haven&apos;t agreed to.
        </p>
      </LegalSection>
      <LegalSection title="What you make">
        <p>
          What you make is yours, within the licence of the model that made it. Some open models don&apos;t allow commercial use, so check{" "}
          <Link href="/settings/licences">Thanks &amp; licences</Link> before you sell your work.
        </p>
      </LegalSection>
      <LegalSection title="Fair use">
        <p>
          Free accounts have limits on storage and runs that keep the studio fast for everyone. We may remove content, or close an account, that breaks these
          terms.
        </p>
      </LegalSection>
      <LegalSection title="The service">
        <p>
          Fuobe is provided as it is, without a warranty. Features can change, and files are kept for as long as the{" "}
          <Link href="/privacy">Privacy</Link> page says.
        </p>
      </LegalSection>
      <LegalSection title="The code">
        <p>
          Fuobe&apos;s code is open source under the MIT licence, and you&apos;re welcome to{" "}
          <a href={FUOBE_REPO} target="_blank" rel="noopener">
            run your own
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
