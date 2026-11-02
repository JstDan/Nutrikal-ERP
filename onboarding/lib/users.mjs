// The demo users of the local database (web/src/lib/db/demo-users.ts)
export const USERS = {
  admin: "00000000-0000-4000-8000-00000000000a",
  sales: "00000000-0000-4000-8000-00000000000b",
  production: "00000000-0000-4000-8000-00000000000d",
  developer: "00000000-0000-4000-8000-00000000000e",
};

/** Session acts as `role` (cookie of the developer's "act as" switch; not logged). */
export const actAs = (role) => async (context) => {
  if (role === "developer") return;
  await context.addCookies([{ name: "nk_act_as", value: USERS[role], domain: "localhost", path: "/" }]);
  // Locally everyone is the demo developer acting as a role; a real user of
  // that role has no "act as" switch, so the recording hides it.
  await context.addInitScript(() => {
    const css = () => {
      const s = document.createElement("style");
      s.textContent = "form:has(#act-as) { display: none !important; }";
      document.documentElement.appendChild(s);
    };
    if (document.documentElement) css(); else document.addEventListener("DOMContentLoaded", css);
  });
};
