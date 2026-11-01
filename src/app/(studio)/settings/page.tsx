import type { Metadata } from "next";
import { AccountsAdmin } from "@/components/accounts-admin";
import { AccountGpuSection } from "@/components/gpu/account-gpu-section";
import { AccountKeysSection } from "@/components/keys/your-keys";
import { OwnerSettings, SettingsIntro } from "@/components/owner-settings";
import { PageHeader, PageShell } from "@/components/page-shell";
import { SettingsForm } from "@/components/settings-form";
import { starterPriceLine } from "@/lib/starter-prices";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  const prices = starterPriceLine();
  return (
    <PageShell>
      <PageHeader title="Settings" description={<SettingsIntro />} />
      <AccountGpuSection />
      <AccountKeysSection prices={prices} />
      <OwnerSettings>
        <SettingsForm prices={prices} />
      </OwnerSettings>
      <AccountsAdmin />
    </PageShell>
  );
}
