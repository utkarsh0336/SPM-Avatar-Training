import { redirect } from "next/navigation";
import { getMe } from "../../../../lib/server-api";
import { AvatarEditor } from "./AvatarEditor";
import styles from "../page.module.css";

export const metadata = {
  title: "Avatrain — Edit Avatar",
};

interface AvatarEditorPageProps {
  params: Promise<{ avatarId: string }>;
}

/** OWNER-only, same gate as the list page (avatars/page.tsx). */
export default async function AvatarEditorPage({ params }: AvatarEditorPageProps) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "OWNER") redirect("/");
  const { avatarId } = await params;

  return (
    <div className={styles.root}>
      <AvatarEditor avatarId={avatarId} />
    </div>
  );
}
