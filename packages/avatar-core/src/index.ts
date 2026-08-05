export type AvatarExpression = "neutral" | "thinking" | "speaking" | "listening";

/**
 * Provider-agnostic avatar rendering surface. `mesh3d` is the default
 * implementation (Phase 2); photoreal providers plug in behind this same
 * interface in Phase 6. See docs/ARCHITECTURE.md.
 */
export interface AvatarRenderer {
  mount(container: HTMLElement): Promise<void>;
  setExpression(expression: AvatarExpression): void;
  setViseme(viseme: string, weight: number): void;
  destroy(): void;
}
