import type { ReactNode } from "react";
import { TopBar } from "../TopBar";
import { LivePreviewPanel } from "../LivePreviewPanel";
import styles from "./layout.module.css";

export default async function StepLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  const stepNumber = Number(step);

  return (
    <>
      <TopBar step={stepNumber} />
      <div className={styles.body}>
        <LivePreviewPanel />
        <div className={styles.content}>{children}</div>
      </div>
    </>
  );
}
