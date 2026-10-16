// What the user chose for a site, kept in chrome.storage.local under `sites` as { [site]: mode }: `off` (SpotSlate does
// nothing there), `local` (only Chrome's translator, nothing is sent) and `noContext` (no site context is learned or
// sent). Sites with the default mode are not kept.

export const DEFAULT_SITE_MODE = Object.freeze({ off: false, local: false, noContext: false });

export function siteModeOf(sites, site) {
  const mode = sites?.[site];
  return { off: mode?.off === true, local: mode?.local === true, noContext: mode?.noContext === true };
}

export function withSiteMode(sites, site, mode) {
  const next = { ...sites };
  const clean = siteModeOf({ [site]: mode }, site);
  if (clean.off || clean.local || clean.noContext) next[site] = clean;
  else delete next[site];
  return next;
}
