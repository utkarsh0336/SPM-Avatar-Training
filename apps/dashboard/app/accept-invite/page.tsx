import styles from "./page.module.css";
import { AcceptInviteForm } from "./AcceptInviteForm";

interface AcceptInvitePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({ searchParams }: AcceptInvitePageProps) {
  const { token } = await searchParams;

  return (
    <div className={styles.page}>
      <AcceptInviteForm token={token ?? ""} />
    </div>
  );
}
