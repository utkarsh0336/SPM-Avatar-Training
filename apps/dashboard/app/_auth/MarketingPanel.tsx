import styles from "./MarketingPanel.module.css";
import { BookIcon, BrainIcon, MicIcon, SparkleIcon, VideoIcon } from "./icons";

const FEATURES = [
  { icon: BrainIcon, title: "AI-Powered Learning", subtitle: "Personalised paths" },
  { icon: MicIcon, title: "Voice AI Tutor", subtitle: "Talk & learn naturally" },
  { icon: VideoIcon, title: "Video Avatars", subtitle: "Face-to-face sessions" },
  { icon: BookIcon, title: "Knowledge Base", subtitle: "10K+ curated articles" },
];

const STATS = [
  { value: "500K+", label: "Learners" },
  { value: "98%", label: "Satisfaction" },
  { value: "10K+", label: "Articles" },
];

type MarketingPanelProps = {
  imageSrc: string;
  imageAlt: string;
};

/**
 * Shared brand/marketing left panel for the auth screens (login, signup).
 * Approximated from the Figma "Authentication" screen (file XiX01ldFGU7GDEGQ0JmuOJ,
 * node 41:8) — see MarketingPanel.module.css for the same caveat on exact tokens.
 */
export function MarketingPanel({ imageSrc, imageAlt }: MarketingPanelProps) {
  return (
    <section className={styles.marketing}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <SparkleIcon />
        </span>
        <div>
          <div className={styles.brandName}>Mariox</div>
          <div className={styles.brandTagline}>Enterprise Learning</div>
        </div>
      </div>

      <div className={styles.avatarCard}>
        <div className={styles.avatarPlaceholder}>
          <img src={imageSrc} alt={imageAlt} className={styles.avatarPhoto} />
        </div>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          Live AI
        </span>
        <div className={styles.speechOverlay}>
          <div className={styles.speechLabel}>AI Assistant</div>
          <div className={styles.speechText}>&ldquo;How can I help you learn today?&rdquo;</div>
          <div className={styles.waveform}>
            {[6, 10, 4, 12, 7, 3, 9].map((height, index) => (
              <span key={index} style={{ height: `${height}px` }} />
            ))}
          </div>
        </div>
      </div>

      <div>
        <h1 className={styles.headline}>
          Learn Smarter with
          <br />
          <span className={styles.headlineAccent}>AI-Powered Avatars</span>
        </h1>
        <p className={styles.subtext}>
          Enterprise training reimagined. Converse, practice, and grow with your personal AI
          tutor.
        </p>
      </div>

      <div className={styles.stats}>
        {STATS.map((stat) => (
          <div key={stat.label} className={styles.stat}>
            <div className={styles.statValue}>{stat.value}</div>
            <div className={styles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div className={styles.features}>
        {FEATURES.map(({ icon: Icon, title, subtitle }) => (
          <div key={title} className={styles.featureCard}>
            <span className={styles.featureIcon}>
              <Icon />
            </span>
            <div>
              <div className={styles.featureTitle}>{title}</div>
              <div className={styles.featureSubtitle}>{subtitle}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
