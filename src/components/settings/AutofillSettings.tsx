"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Copy, Download, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  createExtensionToken,
  getAutofillAnswers,
  saveAutofillAnswers,
} from "@/actions/autofill.actions";
import type { SavedAnswer } from "@/lib/autofill/types";
import { normalizeQuestion } from "@/lib/autofill/classify";

export const EXTENSION_DOWNLOAD_PATH = "/extension/jobsync-autofill.xpi";

// Questions most forms ask that the AI is never allowed to guess
const COMMON_QUESTIONS = [
  "Are you legally authorized to work in the country where this job is located?",
  "Will you now or in the future require visa sponsorship?",
  "What are your salary expectations?",
  "When is the earliest you could start?",
  "Are you willing to relocate?",
  "How did you hear about this job?",
  "Gender",
  "Race / ethnicity",
  "Are you Hispanic or Latino?",
  "Veteran status",
  "Disability status",
];

function newAnswer(question = ""): SavedAnswer {
  return {
    id: globalThis.crypto.randomUUID(),
    question,
    answer: "",
    updatedAt: "",
  };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toastError("Could not copy. Select the text and copy it yourself.");
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

const noSubscribe = () => () => {};

function ExtensionSetup() {
  // Empty during server rendering, the real address once in the browser
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const [token, setToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const result = await createExtensionToken();
      if (result.success) setToken(result.token);
      else toastError(result.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h4 className="font-medium">Firefox extension</h4>
      <ol className="list-decimal space-y-3 pl-5 text-sm">
        <li>
          <a
            href={EXTENSION_DOWNLOAD_PATH}
            className="inline-flex items-center gap-1 underline"
            download
          >
            <Download className="h-4 w-4" />
            Download the extension
          </a>{" "}
          and install it in Firefox. See the help page for the ways to install
          an extension that is not from Mozilla&apos;s add-on site.
        </li>
        <li>
          In the extension&apos;s settings, enter this JobSync address:
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-xs">{origin}</code>
            {origin && <CopyButton text={origin} label="Copy JobSync address" />}
          </div>
        </li>
        <li>
          Create an access token and paste it into the extension&apos;s
          settings. It is shown only once and lasts a year; revoke it under
          MCP Access.
          <div className="mt-2 space-y-2">
            {token ? (
              <div className="flex items-center gap-2">
                <code className="break-all rounded bg-muted px-2 py-1 text-xs">{token}</code>
                <CopyButton text={token} label="Copy access token" />
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={create} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Create access token
              </Button>
            )}
          </div>
        </li>
        <li>
          On a job application, click the JobSync button in the toolbar (or
          press Alt+Shift+J). Review every field before you submit.
        </li>
      </ol>
    </div>
  );
}

function AutofillSettings() {
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAutofillAnswers()
      .then((a) => !cancelled && setAnswers(a))
      .catch(() => toastError("Could not load saved answers."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const missingCommon = useMemo(() => {
    const have = new Set(answers.map((a) => normalizeQuestion(a.question)));
    return COMMON_QUESTIONS.filter((q) => !have.has(normalizeQuestion(q)));
  }, [answers]);

  const update = (id: string, patch: Partial<SavedAnswer>) =>
    setAnswers((list) =>
      list.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: "" } : a)),
    );

  const save = async () => {
    setSaving(true);
    try {
      const complete = answers.filter((a) => a.question.trim() && a.answer.trim());
      const result = await saveAutofillAnswers(complete);
      if (result.success) {
        setAnswers(result.answers);
        toastSuccess("Your saved answers have been updated.");
      } else {
        toastError(result.message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-lg font-medium">Application Autofill</h3>
        <p className="text-sm text-muted-foreground">
          The JobSync Firefox extension fills in job application forms from
          your resume, these saved answers and your AI provider. It never
          submits a form.
        </p>
      </div>

      <ExtensionSetup />

      <div className="space-y-3">
        <div>
          <h4 className="font-medium">Saved answers</h4>
          <p className="text-sm text-muted-foreground">
            Reused whenever a form asks the same kind of question. Questions
            about work authorization, visas, salary, demographics and
            disability are only ever filled from here, never guessed. The
            extension can add answers you type on a form.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading answers...
          </div>
        ) : (
          <>
            {answers.length === 0 && (
              <p className="text-sm text-muted-foreground">No saved answers yet.</p>
            )}
            <ul className="space-y-3">
              {answers.map((a, i) => (
                <li key={a.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`q-${a.id}`}>Question {i + 1}</Label>
                      <Input
                        id={`q-${a.id}`}
                        value={a.question}
                        maxLength={300}
                        onChange={(e) => update(a.id, { question: e.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-6"
                      aria-label={`Delete answer ${i + 1}`}
                      onClick={() => setAnswers((list) => list.filter((x) => x.id !== a.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`a-${a.id}`}>Answer {i + 1}</Label>
                    <Textarea
                      id={`a-${a.id}`}
                      value={a.answer}
                      maxLength={2000}
                      rows={2}
                      onChange={(e) => update(a.id, { answer: e.target.value })}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAnswers((list) => [...list, newAnswer()])}
              >
                <Plus className="mr-1 h-4 w-4" /> Add answer
              </Button>
            </div>

            {missingCommon.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Common questions:</p>
                <div className="flex flex-wrap gap-2">
                  {missingCommon.map((q) => (
                    <Button
                      key={q}
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-auto whitespace-normal py-1 text-left text-xs"
                      onClick={() => setAnswers((list) => [...list, newAnswer(q)])}
                    >
                      <Plus className="mr-1 h-3 w-3 shrink-0" /> {q}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button type="button" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save answers
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default AutofillSettings;
