// Settings shared by the content scripts. Their shadow roots are closed, so the page cannot read a translation, a
// draft or the site context in them, nor press their buttons. The e2e tests run a copy with them open.
Object.assign((globalThis.paragloss ??= {}), { SHADOW_MODE: 'closed' });
