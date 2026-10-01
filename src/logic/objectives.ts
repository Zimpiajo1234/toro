import type { GameSnapshot } from '../core/types';

/**
 * Objectives left, the HUD's «Quedan N»: the boxes the level still needs put in their place, on the targets its
 * completion reads (GameState: every zone and every storage slot with a cue satisfied). A zone counts the boxes of its
 * recipe its stack does not hold correctly yet (BoxState.correct: a classic zone 1 until its box is on it, a recipe
 * zone one per missing step, so the count goes down one by one as the stack grows); a storage slot with a cue counts 1
 * until it holds its destined box (StorageSlotState.satisfied: in a stack, on satisfied levels). «Libre» slots never
 * count, nor does a wrong box on a target; a box lifted off its place counts again. Every valid level has one box per
 * place (validateLevel), so the count is 0 exactly when the level is complete. Pure; index loops, nothing allocated.
 */
export function objectivesLeft(snapshot: Pick<GameSnapshot, 'zones' | 'boxes' | 'storageSlots'>): number {
  const { zones, boxes, storageSlots } = snapshot;
  let left = 0;
  for (let i = 0; i < zones.length; i++) left += zones[i].recipe.length;
  // A box is correct on a zone only within the right start of its stack, never past its recipe.
  for (let i = 0; i < boxes.length; i++) if (boxes[i].correct && boxes[i].zoneId !== null) left--;
  for (let i = 0; i < storageSlots.length; i++) if (storageSlots[i].accepts !== null && !storageSlots[i].satisfied) left++;
  return left;
}
