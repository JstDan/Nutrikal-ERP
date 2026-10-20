// Light / dark theme. The choice lives in a cookie on the device; without
// one the page follows the system setting.
export const THEME_COOKIE = "nk_theme";

/** Runs before first paint: follow the system setting when no theme was chosen. */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;if(!d.dataset.theme){d.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}})()`;
