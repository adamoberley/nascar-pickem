import { useEffect, useRef, useState } from "react";
import type { PickDoc, RaceDoc } from "../lib/types";
import { savePick } from "../lib/api";

type DraftPick = { tierA: string[]; tierB: string[]; tierC: string[] };

const EMPTY_DRAFT_PICK: DraftPick = { tierA: [], tierB: [], tierC: [] };

export function usePickDraft(input: {
  selectedLeagueId: string | null;
  primaryRace: (RaceDoc & { id: string }) | null;
  pickDoc: PickDoc | null;
}) {
  const { selectedLeagueId, primaryRace, pickDoc } = input;
  const [draftPick, setDraftPick] = useState<DraftPick>(EMPTY_DRAFT_PICK);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickStatus, setPickStatus] = useState("");
  const [pickSaving, setPickSaving] = useState(false);
  const pickDirtyRef = useRef(false);

  useEffect(() => {
    if (!primaryRace) {
      setDraftPick(EMPTY_DRAFT_PICK);
      pickDirtyRef.current = false;
      return;
    }

    if (pickDoc) {
      if (!pickDirtyRef.current) {
        setDraftPick({
          tierA: pickDoc.tierA,
          tierB: pickDoc.tierB,
          tierC: pickDoc.tierC,
        });
        pickDirtyRef.current = false;
      }
      return;
    }

    setDraftPick(EMPTY_DRAFT_PICK);
    pickDirtyRef.current = false;
  }, [pickDoc, primaryRace?.id]);

  const isPickLocked =
    !primaryRace ||
    primaryRace.status !== "scheduled" ||
    primaryRace.lockTime.toMillis() <= Date.now();

  const isPickComplete =
    draftPick.tierA.length === 3 &&
    draftPick.tierB.length === 2 &&
    draftPick.tierC.length === 1 &&
    new Set([...draftPick.tierA, ...draftPick.tierB, ...draftPick.tierC]).size === 6;

  const togglePick = (
    tier: "tierA" | "tierB" | "tierC",
    driverId: string,
    limit: number,
  ) => {
    setPickError(null);
    setPickStatus("");
    pickDirtyRef.current = true;

    setDraftPick((current) => {
      const nextTierValues = current[tier].includes(driverId)
        ? current[tier].filter((value) => value !== driverId)
        : current[tier].length < limit
          ? [...current[tier], driverId]
          : current[tier];

      return {
        ...current,
        [tier]: nextTierValues,
      };
    });
  };

  useEffect(() => {
    if (
      !pickDirtyRef.current ||
      !isPickComplete ||
      !selectedLeagueId ||
      !primaryRace ||
      isPickLocked ||
      pickSaving
    ) {
      return;
    }
    const allDrivers = [...draftPick.tierA, ...draftPick.tierB, ...draftPick.tierC];
    if (new Set(allDrivers).size !== allDrivers.length) return;

    pickDirtyRef.current = false;
    setPickError(null);
    setPickStatus("");
    setPickSaving(true);
    savePick({
      leagueId: selectedLeagueId,
      raceId: primaryRace.id,
      tierA: draftPick.tierA,
      tierB: draftPick.tierB,
      tierC: draftPick.tierC,
    })
      .then(() => {
        setPickStatus("Picks saved.");
      })
      .catch((err) => {
        setPickError((err as Error).message);
        pickDirtyRef.current = true;
      })
      .finally(() => {
        setPickSaving(false);
      });
  }, [isPickComplete, selectedLeagueId, primaryRace?.id, isPickLocked, pickSaving, draftPick.tierA, draftPick.tierB, draftPick.tierC]);

  const savePickSubmit = async () => {
    if (!selectedLeagueId || !primaryRace) {
      return;
    }

    setPickError(null);
    setPickStatus("");

    const allDrivers = [...draftPick.tierA, ...draftPick.tierB, ...draftPick.tierC];
    if (new Set(allDrivers).size !== allDrivers.length) {
      setPickError("A driver can only be selected once across all tiers.");
      return;
    }

    if (draftPick.tierA.length !== 3 || draftPick.tierB.length !== 2 || draftPick.tierC.length !== 1) {
      setPickError("You must pick exactly 3 Tier A, 2 Tier B, and 1 Tier C drivers.");
      return;
    }

    setPickSaving(true);
    try {
      await savePick({
        leagueId: selectedLeagueId,
        raceId: primaryRace.id,
        ...draftPick,
      });
      setPickStatus("Picks saved.");
      pickDirtyRef.current = false;
    } catch (error) {
      setPickError((error as Error).message);
    } finally {
      setPickSaving(false);
    }
  };

  return {
    draftPick,
    isPickLocked,
    pickError,
    pickStatus,
    pickSaving,
    togglePick,
    savePickSubmit,
  };
}
