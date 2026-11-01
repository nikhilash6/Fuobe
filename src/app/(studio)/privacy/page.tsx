import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { FUOBE_REPO } from "@/lib/connections";

export const metadata: Metadata = { title: "Privacy", description: "What Fuobe keeps when you use it, for how long, and how to remove it." };

export default function Page() {
  return (
    <LegalPage title="Privacy" lead="What Fuobe keeps when you use it, for how long, and how to remove it." updated="1 November 2026">
      <LegalSection title="What we keep">
        <p>
          Your email address, and a protected form of your password: the password itself is never stored. The pictures, clips and sound you upload, and
          everything you make. The address of the GPU you connect, so your runs can reach it.
        </p>
      </LegalSection>
      <LegalSection title="How long we keep it">
        <p>
          Uploads are deleted after 14 days. Your runs and what they made are deleted after 30 days, so download
          anything you want to keep.
        </p>
      </LegalSection>
      <LegalSection title="Who can see it">
        <p>
          The Fuobe team can see what you upload and make, to keep the service working and safe. We don&apos;t sell your data, and we don&apos;t
          show it to anyone else.
        </p>
        <p>When you make a share link, anyone who has that link can see what it shares.</p>
      </LegalSection>
      <LegalSection title="Your GPU">
        <p>When you connect your own GPU, your runs go to it from Fuobe, and the results come back to your account.</p>
      </LegalSection>
      <LegalSection title="Cookies">
        <p>
          One cookie keeps you signed in. Your browser also remembers small preferences, such as your theme and how the sidebar looks. There are no
          advertising or tracking cookies.
        </p>
      </LegalSection>
      <LegalSection title="Deleting your account">
        <p>
          <Link href="/settings">Settings</Link> → Delete account removes your account, your runs, your files and your GPU connection at once.
        </p>
      </LegalSection>
      <LegalSection title="Open source">
        <p>
          Fuobe is open source, so you can read exactly how it handles your data{" "}
          <a href={FUOBE_REPO} target="_blank" rel="noopener">
            on GitHub
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
