"use client";

import { logout } from "../../lib/api-client";

export function LogoutButton() {
  async function handleLogout() {
    await logout();
    window.location.assign("/login");
  }

  return (
    <button type="button" onClick={handleLogout}>
      Log out
    </button>
  );
}
