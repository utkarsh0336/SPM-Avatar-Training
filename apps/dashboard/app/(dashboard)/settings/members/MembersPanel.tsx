"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, inviteMember, listMembers, type MemberResult } from "../../../../lib/api-client";
import { useTranslation } from "../../../../lib/locale/LocaleProvider";
import styles from "./MembersPanel.module.css";

/**
 * Stateful orchestrator, same shape as EmbedSettings.tsx: owns fetch/create
 * state, delegates rendering to the member list. No remove-member/role-change
 * UI — .claude/specs/authentication.md's own Non-Goals defer that; the auth
 * middleware already re-checks Membership every request regardless. See
 * .claude/specs/partner-role.md's UI Changes.
 */
export function MembersPanel() {
  const { t } = useTranslation();
  const [members, setMembers] = useState<MemberResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MEMBER" | "PARTNER">("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await listMembers();
    setMembers(result.members);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleInvite(): Promise<void> {
    if (!email.trim()) return;
    setInviting(true);
    setError(null);
    setInviteUrl(null);
    try {
      const result = await inviteMember(email.trim(), role);
      setInviteUrl(result.inviteUrl);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? (err.body.message ?? t("membersPanel.inviteError")) : t("membersPanel.genericError"));
    } finally {
      setInviting(false);
    }
  }

  if (!loaded) return null;

  return (
    <>
      <div className={styles.inviteCard}>
        <span className={styles.label}>{t("membersPanel.inviteSomeone")}</span>
        <div className={styles.inviteRow}>
          <input
            type="email"
            className={styles.textInput}
            placeholder="teammate@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <select className={styles.select} value={role} onChange={(event) => setRole(event.target.value as "MEMBER" | "PARTNER")}>
            <option value="MEMBER">{t("membersPanel.roleMember")}</option>
            <option value="PARTNER">{t("membersPanel.rolePartner")}</option>
          </select>
          <button
            type="button"
            className={styles.newButton}
            disabled={inviting || !email.trim()}
            onClick={() => void handleInvite()}
          >
            {inviting ? t("membersPanel.inviting") : t("membersPanel.invite")}
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {inviteUrl && (
          <p className={styles.inviteUrl}>
            {t("membersPanel.inviteUrlPrefix")} <code>{inviteUrl}</code>
          </p>
        )}
      </div>

      <div className={styles.list}>
        {members.map((member) => (
          <div key={member.userId} className={styles.row}>
            <span className={styles.email}>{member.email}</span>
            <span
              className={
                member.role === "OWNER" ? styles.ownerBadge : member.role === "PARTNER" ? styles.partnerBadge : styles.memberBadge
              }
            >
              {member.role}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
