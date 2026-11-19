"use client";

import { useState, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreateAutomationSchema,
  type CreateAutomationInput,
} from "@/models/automation.schema";
import {
  createAutomation,
  updateAutomation,
} from "@/actions/automation.actions";
import { toastSuccess, toastError } from "@/lib/toast";
import {
  aiMatchConfig,
  AI_MATCH_DEFAULTS,
  type AiMatchConfig,
  type AutomationWithResume,
  type JobBoard,
} from "@/models/automation.model";
import type { AtsConfigValue } from "../AtsSearchStep";
import {
  EMPTY_ATS,
  emptyConfigFor,
  STEPS,
  parseEditSourceConfig,
  type AtsKey,
} from "./wizardConfig";

interface UseWizardFormArgs {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automations: AutomationWithResume[];
  onSuccess: () => void;
  editAutomation?: AutomationWithResume | null;
}

export function useWizardForm({
  open,
  onOpenChange,
  automations,
  onSuccess,
  editAutomation,
}: UseWizardFormArgs) {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previousInputs, setPreviousInputs] = useState({ open, editAutomation });

  if (
    previousInputs.open !== open ||
    previousInputs.editAutomation !== editAutomation
  ) {
    setPreviousInputs({ open, editAutomation });
    if (open) setStep(0);
  }

  const form = useForm<CreateAutomationInput>({
    resolver: zodResolver(CreateAutomationSchema),
    mode: "onChange",
    defaultValues: {
      name: editAutomation?.name ?? "",
      jobBoard: (editAutomation?.jobBoard as JobBoard) ?? "greenhouse",
      keywords: editAutomation?.keywords ?? "",
      location: editAutomation?.location ?? "",
      sourceConfig: parseEditSourceConfig(editAutomation?.sourceConfig),
      resumeId: editAutomation?.resumeId ?? "",
      matchThreshold: editAutomation?.matchThreshold ?? 80,
      scheduleHour: editAutomation?.scheduleHour ?? 8,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: editAutomation?.name ?? "",
        jobBoard: (editAutomation?.jobBoard as JobBoard) ?? "greenhouse",
        keywords: editAutomation?.keywords ?? "",
        location: editAutomation?.location ?? "",
        sourceConfig: parseEditSourceConfig(editAutomation?.sourceConfig),
        resumeId: editAutomation?.resumeId ?? "",
        matchThreshold: editAutomation?.matchThreshold ?? 80,
        scheduleHour: editAutomation?.scheduleHour ?? 8,
      });
    }
  }, [open, editAutomation, form]);

  const [
    name,
    jobBoard,
    keywords,
    location,
    sourceConfig,
    resumeId,
    matchThreshold,
    scheduleHour,
  ] = useWatch({
    control: form.control,
    name: [
      "name",
      "jobBoard",
      "keywords",
      "location",
      "sourceConfig",
      "resumeId",
      "matchThreshold",
      "scheduleHour",
    ],
  });
  const formValues: CreateAutomationInput = {
    name,
    jobBoard,
    keywords,
    location,
    sourceConfig,
    resumeId,
    matchThreshold,
    scheduleHour,
  };

  const onSubmit = async (data: CreateAutomationInput) => {
    setIsSubmitting(true);
    try {
      const result = editAutomation
        ? await updateAutomation(editAutomation.id, data)
        : await createAutomation(data);

      if (result.success) {
        toastSuccess(
          editAutomation
            ? "Your automation has been updated successfully."
            : "Your automation has been created and will run at the scheduled time.",
          editAutomation ? "Automation updated" : "Automation created",
        );
        form.reset();
        setStep(0);
        onOpenChange(false);
        onSuccess();
      } else {
        toastError(result.message || "Something went wrong");
      }
    } catch (error) {
      toastError("Failed to save automation");
    } finally {
      setIsSubmitting(false);
    }
  };

  const atsKey: AtsKey = formValues.jobBoard;
  const isAiMatch = atsKey === "ai-match";
  // Search automations edit atsConfig; AI Matching edits matchConfig instead
  const atsConfig: AtsConfigValue = isAiMatch
    ? EMPTY_ATS
    : ((formValues.sourceConfig?.[atsKey] as AtsConfigValue | undefined) ??
      emptyConfigFor(atsKey));
  const matchConfig: AiMatchConfig = aiMatchConfig(
    formValues.sourceConfig?.["ai-match"],
  );

  // The remote board's default (every feed on) and AI Matching's settings are
  // only display fallbacks until written to the form; without this, a user
  // who changes nothing on the second step would submit no settings at all.
  const needsDefault =
    open &&
    (atsKey === "remote" || isAiMatch) &&
    !formValues.sourceConfig?.[atsKey];
  useEffect(() => {
    if (!needsDefault) return;
    form.setValue(
      "sourceConfig",
      (atsKey === "remote"
        ? { remote: emptyConfigFor("remote") }
        : { "ai-match": { ...AI_MATCH_DEFAULTS } }) as CreateAutomationInput["sourceConfig"],
      { shouldValidate: true },
    );
  }, [needsDefault, atsKey, form]);

  const canGoNext = () => {
    switch (step) {
      case 0:
        return (formValues.name?.trim().length ?? 0) > 0;
      case 1:
        return isAiMatch
          ? matchConfig.includeDiscovered || matchConfig.includeTracked
          : (atsConfig.companies?.length ?? 0) > 0;
      case 2:
        return (formValues.resumeId?.length ?? 0) > 0;
      case 3:
      case 4:
        return true;
      default:
        return false;
    }
  };

  // Hours already claimed by the user's other automations. Only one automation
  // may run per hourly slot, so the schedule step rejects a taken hour.
  const takenHours = new Set(
    automations
      .filter((a) => a.id !== editAutomation?.id)
      .map((a) => a.scheduleHour),
  );

  const nextStep = () => {
    if (step === 4 && takenHours.has(formValues.scheduleHour)) {
      form.setError("scheduleHour", {
        message: `Another automation already runs at ${(
          formValues.scheduleHour ?? 8
        )
          .toString()
          .padStart(2, "0")}:00. Please choose a different time.`,
      });
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleClose = () => {
    form.reset();
    setStep(0);
    onOpenChange(false);
  };

  return {
    form,
    formValues,
    step,
    isSubmitting,
    atsKey,
    atsConfig,
    matchConfig,
    takenHours,
    canGoNext,
    nextStep,
    prevStep,
    handleClose,
    onSubmit,
  };
}
