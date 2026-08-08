import styles from "./page.module.css";
import { SignupForm } from "./SignupForm";
import { MarketingPanel } from "../_auth/MarketingPanel";

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <MarketingPanel imageSrc="/auth/signup-hero.jpeg" imageAlt="Trainer using the AI avatar platform" />

      <section className={styles.authPanel}>
        <SignupForm />
      </section>
    </div>
  );
}
