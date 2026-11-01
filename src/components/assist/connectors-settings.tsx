"use client";

import { AlertTriangle, Info, KeyRound, Loader2, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { checkConnectorUrl, MAX_CONNECTOR_NAME, MAX_CONNECTORS, parseToolList, type ConnectorView } from "@/lib/assist-connectors";
import { toastError } from "@/lib/refusals";
import { useConnectorActions, useConnectors } from "./hooks";

/**
 * Settings → Assist connectors: remote MCP servers whose tools Claude may use in Assist chats. The
 * browser sends a URL and token once and only ever gets them back masked; nothing here connects to
 * the URL (Claude does, from Anthropic's servers).
 */
export function ConnectorSettings({ claudeReady }: { claudeReady: boolean }) {
  const list = useConnectors();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const items = list.data ?? [];
  const full = items.length >= MAX_CONNECTORS;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1.5">
          <p>
            Connectors work in Claude chats (Smart, or Manual with a Claude model){claudeReady ? "" : " — add an Anthropic API key above first"}. Claude reaches them from Anthropic&apos;s servers, so each needs a
            public https address. Chats on a local model (Ollama, LM Studio or Unsloth Studio) or the offline planner can&apos;t use them. Tool calls cost Claude tokens; the chat lists each connector tool Claude used.
          </p>
          <p>
            <span className="font-medium text-foreground">Connector tools run without asking.</span> Claude calls them inside its reply, so approval cards (Ask first) and auto-run&apos;s cost cap don&apos;t
            cover them; Claude is told to check with you in chat before changing anything. Limit a connector to the tools you trust with <span className="font-medium text-foreground">Allowed tools</span>.
            Scheduled tasks use connectors only when the task says so.
          </p>
        </div>
      </div>
      {list.isLoading ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : items.length ? (
        <ul className="divide-y rounded-xl border sm:w-[40rem] sm:max-w-full">
          {items.map((c) =>
            editing === c.id ? (
              <li key={c.id} className="p-3">
                <ConnectorForm connector={c} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <Row key={c.id} c={c} onEdit={() => setEditing(c.id)} />
            ),
          )}
        </ul>
      ) : (
        !adding && <p className="text-[13px] text-muted-foreground">No connectors yet. Add one with its MCP server URL — the app&apos;s docs list it (often ending in /mcp).</p>
      )}
      {adding ? (
        <div className="rounded-xl border p-3 sm:w-[40rem] sm:max-w-full">
          <ConnectorForm onDone={() => setAdding(false)} />
        </div>
      ) : (
        <Button size="sm" variant="secondary" disabled={full} onClick={() => setAdding(true)}>
          <Plus /> {full ? `Up to ${MAX_CONNECTORS} connectors` : "Add a connector"}
        </Button>
      )}
    </div>
  );
}

function Row({ c, onEdit }: { c: ConnectorView; onEdit: () => void }) {
  const actions = useConnectorActions();
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Plug className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{c.name}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={c.url}>
          {c.url}
        </p>
        <p className="text-[11px] text-muted-foreground">
          <KeyRound className="mr-1 inline size-3 align-[-2px]" aria-hidden />
          {c.hasToken ? <span className="font-mono">{c.token}</span> : "No token"} · Claude sees it as <span className="font-mono">{c.slug}</span>
        </p>
        <p className="text-[11px] break-words text-muted-foreground">
          {c.tools ? (
            <>
              Only: <span className="font-mono">{c.tools.join(", ")}</span>
            </>
          ) : (
            "Every tool it lists"
          )}
        </p>
        {c.warning && (
          <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden /> {c.warning}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Switch
          checked={c.enabled}
          onCheckedChange={(on) => void actions.update(c.id, { enabled: on }).catch((e) => toastError(e))}
          aria-label={c.enabled ? `Switch off ${c.name}` : `Switch on ${c.name}`}
        />
        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={`Edit ${c.name}`} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(true)}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
            <AlertDialogDescription>Claude stops using its tools, and its token is deleted from this server. Chats that used it keep what it returned.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void actions.remove(c.id).catch((e) => toastError(e))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** Add a connector, or edit one: an empty token field keeps the saved token. */
function ConnectorForm({ connector, onDone }: { connector?: ConnectorView; onDone: () => void }) {
  const actions = useConnectorActions();
  const ids = { name: useId(), url: useId(), token: useId(), hint: useId(), tools: useId(), toolsHint: useId() };
  const [name, setName] = useState(connector?.name ?? "");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [tools, setTools] = useState(connector?.tools?.join(", ") ?? "");
  const [dropToken, setDropToken] = useState(false);
  const [busy, setBusy] = useState(false);
  // The server enforces the http rule (it knows FUOBE_ALLOW_PRIVATE_URLS); here only the shape is checked.
  const check = url.trim() ? checkConnectorUrl(url, true) : null;
  const urlError = check && "error" in check ? check.error : null;
  const toolList = parseToolList(tools);
  const toolsError = "error" in toolList ? toolList.error : null;
  const canSave = !!name.trim() && !toolsError && (connector ? !urlError : !!url.trim() && !urlError);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    try {
      if (connector) {
        await actions.update(connector.id, {
          name: name.trim(),
          ...(url.trim() && { url: url.trim() }),
          ...(dropToken ? { token: "" } : token.trim() ? { token: token.trim() } : {}),
          tools: tools.trim() || null,
        });
        toast.success("Connector saved", { duration: 1500 });
      } else {
        await actions.create({ name: name.trim(), url: url.trim(), ...(token.trim() && { token: token.trim() }), ...(tools.trim() && { tools: tools.trim() }) });
        toast.success(`${name.trim()} connected`, { description: "Claude chats can use its tools from the next message.", duration: 2500 });
      }
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3" aria-label={connector ? `Edit ${connector.name}` : "Add a connector"}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-1.5">
          <Label htmlFor={ids.name} className="text-[13px]">
            Name
          </Label>
          <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_CONNECTOR_NAME} placeholder="e.g. Notion" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.url} className="text-[13px]">
            MCP server URL
          </Label>
          <Input
            id={ids.url}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={connector ? `Unchanged: ${connector.url}` : "https://mcp.example.com/mcp"}
            aria-invalid={!!urlError}
            aria-describedby={urlError ? ids.hint : undefined}
          />
          {urlError && (
            <p id={ids.hint} className="text-[12px] text-destructive">
              {urlError}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.token} className="text-[13px]">
          Token <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={ids.token}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          disabled={dropToken}
          onChange={(e) => setToken(e.target.value)}
          placeholder={connector?.hasToken ? `Saved (${connector.token}) — type a new one to replace it` : "The server's API key or access token"}
        />
        <p className="text-[12px] text-muted-foreground">Sent as an Authorization: Bearer header, by Anthropic, to this server only. Stored on this server like your other keys and never shown again.</p>
        {connector?.hasToken && (
          <label className="inline-flex items-center gap-2 text-[12px]">
            <Checkbox checked={dropToken} onCheckedChange={(v) => setDropToken(v === true)} /> Remove the saved token
          </label>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.tools} className="text-[13px]">
          Allowed tools <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={ids.tools}
          autoComplete="off"
          spellCheck={false}
          value={tools}
          onChange={(e) => setTools(e.target.value)}
          placeholder="Every tool — or only these, e.g. search_pages, get_page"
          aria-invalid={!!toolsError}
          aria-describedby={ids.toolsHint}
          className="font-mono text-[13px]"
        />
        <p id={ids.toolsHint} className={toolsError ? "text-[12px] text-destructive" : "text-[12px] text-muted-foreground"}>
          {toolsError ??
            "Tool names as the server lists them (its docs, or the chat's “Notion · search_pages” lines), separated by commas. Leave it empty to allow every tool; prefer read-only ones for scheduled tasks."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !canSave}>
          {busy && <Loader2 className="animate-spin" />} {connector ? "Save" : "Add connector"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
