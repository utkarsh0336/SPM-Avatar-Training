import styles from "./page.module.css";
import { LoginForm } from "./LoginForm";
import { MarketingPanel } from "../_auth/MarketingPanel";

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <MarketingPanel imageSrc="/auth/login-hero.jpeg" imageAlt="Learner using the AI avatar trainer" />

      <section className={styles.authPanel}>
        <LoginForm />
      </section>
    </div>
  );
}
