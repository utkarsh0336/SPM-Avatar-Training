import replicasData from "./replicas.json" with { type: "json" };

export interface Replica {
  id: string;
  style: string;
  gender: string;
  outfit: string;
  /**
   * Overrides for vrm-material-tint.ts's default hint lists
   * (["skin","face","body"] / ["hair"]) — only needed if this replica's
   * .vrm source model uses non-standard material naming. Optional; most
   * VRoid Studio exports need no override.
   */
  skinMaterialNameHints?: string[];
  hairMaterialNameHints?: string[];
}

export interface ReplicaRegistry {
  defaultReplicaId: string;
  replicas: Replica[];
}

const registry = replicasData as ReplicaRegistry;

export interface ResolveReplicaInput {
  style: string;
  gender: string;
  outfit: string;
}

/**
 * Maps the Avatar Builder wizard's style/gender/outfit picks to the nearest
 * entry in the small, hand-curated replicas.json registry — real avatar
 * renderers work from a small set of pre-trained faces, not arbitrary
 * parameters (brief §6). Pure and never throws: exact match -> nearest by
 * style+gender -> nearest by style -> the registry's default, warning on
 * every non-exact tier so a bad wizard combination never crashes a session.
 */
export function resolveReplicaId(input: ResolveReplicaInput): string {
  const exact = registry.replicas.find(
    (replica) =>
      replica.style === input.style && replica.gender === input.gender && replica.outfit === input.outfit,
  );
  if (exact) return exact.id;

  const byStyleAndGender = registry.replicas.find(
    (replica) => replica.style === input.style && replica.gender === input.gender,
  );
  if (byStyleAndGender) {
    console.warn(
      `[replica-resolver] no exact match for style=${input.style} gender=${input.gender} outfit=${input.outfit} — using nearest match by style+gender: ${byStyleAndGender.id}`,
    );
    return byStyleAndGender.id;
  }

  const byStyle = registry.replicas.find((replica) => replica.style === input.style);
  if (byStyle) {
    console.warn(
      `[replica-resolver] no match by style+gender for style=${input.style} gender=${input.gender} outfit=${input.outfit} — using nearest match by style: ${byStyle.id}`,
    );
    return byStyle.id;
  }

  console.warn(
    `[replica-resolver] no match at all for style=${input.style} gender=${input.gender} outfit=${input.outfit} — using default: ${registry.defaultReplicaId}`,
  );
  return registry.defaultReplicaId;
}
