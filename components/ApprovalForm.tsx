"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideApproval } from "@/app/actions/approvals";
import { Button } from "@/components/ui/Button";

export function ApprovalForm({
  token,
  context,
  editable,
}: {
  token: string;
  /** The resolved text the approver was shown. */
  context: string[];
  /** False when the step showed nothing editable. */
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(context[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(decision: "approved" | "rejected", withEdit = false) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await decideApproval(token, decision, withEdit ? { value: draft } : undefined);
        if (!result.ok) setError(result.error);
        router.refresh();
      } catch {
        setError("That didn't go through. Reload the page to see where the run stands.");
      }
    });
  }

  return (
    <div>
      {editing ? (
        <>
          <label
            htmlFor="approval-edit"
            className="text-muted mb-1.5 block text-xs font-medium"
          >
            Your version — this replaces the text the remaining steps use
          </label>
          <textarea
            id="approval-edit"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={8}
            className="w-full rounded-lg border border-rule px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-accent"
          />
        </>
      ) : (
        context.length > 0 && (
          <div className="bg-paper rounded-lg border border-rule p-4">
            {context.map((entry, index) => (
              <p
                key={index}
                className="mb-3 text-sm leading-relaxed whitespace-pre-line last:mb-0"
              >
                {entry}
              </p>
            ))}
          </div>
        )
      )}

      {error && <p className="text-failed mt-3 text-sm">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => submit("approved", editing)}
        >
          {pending ? "Working…" : editing ? "Save and continue" : "Approve and continue"}
        </Button>

        {editable && !editing && (
          <Button disabled={pending} onClick={() => setEditing(true)}>
            Edit first
          </Button>
        )}
        {editing && (
          <Button
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setDraft(context[0] ?? "");
            }}
          >
            Cancel edit
          </Button>
        )}

        <Button variant="danger" disabled={pending} onClick={() => submit("rejected")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
