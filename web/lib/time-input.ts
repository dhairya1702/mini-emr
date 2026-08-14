export function openNativeTimePicker(input: HTMLInputElement) {
  if (typeof input.showPicker !== "function") {
    return;
  }
  try {
    input.showPicker();
  } catch {
    // Browsers may reject showPicker outside a direct user action.
  }
}
