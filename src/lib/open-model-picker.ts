/**
 * "Pick another model" from somewhere else on a studio's page (a failed run's tile): the studio's composer opens its model
 * picker. The composer listens; with none on the page, nothing happens (the tile shows the button only inside a studio).
 */
export const OPEN_MODEL_PICKER_EVENT = "fuobe:open-model-picker";

export function openModelPicker(): void {
  window.dispatchEvent(new Event(OPEN_MODEL_PICKER_EVENT));
}
