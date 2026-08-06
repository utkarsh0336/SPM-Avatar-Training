import styles from "./page.module.css";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <SignupForm />
    </div>
  );
}
