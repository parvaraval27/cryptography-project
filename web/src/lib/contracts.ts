export type UserInput = {
  id: string;
  balance: number;
};

export type UserEntryRow = {
  rowId?: string;
  name: string;
  accountId: string;
  balance: number | string;
};

export type SnapshotRequest = {
  users: UserEntryRow[];
  selectedUserId?: string;
};

export type MerkleNodePayload = {
  nodeId: string;
  level: number;
  index: number;
  hash: string;
  hashShort: string;
  sum: string;
  userId?: string;
  leftChildId?: string | null;
  rightChildId?: string | null;
};

export type MerkleEdgePayload = {
  source: string;
  target: string;
};

export type PhantomPathStepPayload = {
  step: number;
  treeNodeId: string;
  position: "left" | "right" | "self";
  siblingNodeId?: string | null;
  estimatedGateIndex?: number;
};

export type ProofPhantomPathPayload = {
  leafNodeId: string | null;
  rootNodeId: string;
  stepSequence: PhantomPathStepPayload[];
};

export type ConstraintSnapshotPayload = {
  balanceInputs: string[];
  partialSums: string[];
  totalLiabilities: string;
  constraintGateCount: number;
};

export type MerkleSnapshotPayload = {
  root: MerkleNodePayload;
  levels: MerkleNodePayload[][];
  edges: MerkleEdgePayload[];
  leafOrder: string[];
  leafGenerationSequence?: LeafGenerationStepPayload[];
  mergeMetadata?: MergeAnimationPayload[];
  proofPhantomPath?: ProofPhantomPathPayload;
  constraintSnapshot?: ConstraintSnapshotPayload;
};

export type LeafGenerationStepPayload = {
  inputRowIndex: number;
  accountId: string;
  targetNodeId: string;
  delayMs: number;
};

export type MergeAnimationPayload = {
  parentNodeId: string;
  leftChildId: string;
  rightChildId: string;
  leftSum: string;
  rightSum: string;
  parentSum: string;
  isSelfMerge: boolean;
  level: number;
  index: number;
};

export type ProofStepPayload = {
  step: number;
  position: "left" | "right" | "self";
  siblingHash: string;
  inputHash: string;
  outputHash: string;
};

export type ProofTracePayload = {
  userId: string;
  rootHash: string;
  valid: boolean;
  proof: Array<{ hash: string; position: "left" | "right" | "self" }>;
  steps: ProofStepPayload[];
};

export type SnapshotResponse = {
  snapshot: MerkleSnapshotPayload;
  proof: ProofTracePayload;
};

export type ZkStagePayload = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
  progress?: number;
};

export type ZkProverEventPayload = {
  stage: "input-stream" | "prover-active" | "commitment-emission" | "verification";
  message: string;
  delayMs: number;
  commitmentKey?: string;
  packetHash?: string;
};

export type ZkVerifierLogPayload = {
  step: number;
  label: string;
  passed: boolean;
};

export type ZkMetricPayload = {
  label: string;
  value: string;
  hint: string;
};

export type ProverGeometryZonePayload = {
  commitmentKey: string;
  lane: number;
  emergenceDelayMs: number;
  completionDelayMs: number;
  structureHint: "input-encoding" | "constraint-poly" | "verifier-check";
};

export type ProverGeometryPayload = {
  inputBusWidth: number;
  constraintGridSize: number;
  commitmentEmissionZones: ProverGeometryZonePayload[];
};

export type VerifierCrystalPairingPayload = {
  step: number;
  equation: string;
  passed: boolean;
};

export type VerifierCrystalPayload = {
  isValid: boolean;
  crystallizationDelayMs: number;
  pairing: VerifierCrystalPairingPayload[];
  luminosity: "soft" | "brilliant" | "fault";
};

export type ProofAssemblyProgressPayload = {
  currentStage: "input-stream" | "prover-active" | "commitment-emission" | "verification";
  completionPercent: number;
  estimatedMs: number;
};

export type ZkVerificationPayload = {
  proof: unknown;
  publicSignals: string[];
  publicSignalLabels: string[];
  circuitVariant: number;
  merkleRootPublic: string;
};

export type ZkVerifyRequest = {
  verificationPayload: ZkVerificationPayload;
  verifyRoot: string;
  verifyAddress: string;
  knownAccountIds: string[];
};

export type ZkVerifyResponse = {
  isValid: boolean;
  verifierPhase: "passed" | "failed";
  verificationReasonCode:
    | "ok"
    | "missing-verification-input"
    | "unknown-address"
    | "malformed-proof-payload"
    | "public-root-mismatch"
    | "signal-root-mismatch"
    | "missing-verification-key"
    | "pairing-check-failed";
  message: string;
  verifierLog: ZkVerifierLogPayload[];
};

export type ZkVisualizationPayload = {
  protocol: string;
  curve: string;
  fingerprint: string;
  createdAt: string;
  isValid: boolean;
  circuitVariant: number;
  merkleRoot: string;
  proofEnvelopeType: string;
  metadata: {
    reserves: string;
    usersProvided: number;
    maxUsers: number;
  };
  publicSignalCount: number;
  commitmentCount: number;
  couplingStatus: "linked" | "mismatched" | "missing";
  verificationReasonCode?: string;
  verificationPipelines?: Array<{
    id: string;
    title: string;
    checks: Array<{
      label: string;
      passed: boolean;
    }>;
  }>;
  publicSignalsBreakdown?: {
    reservesPublic: string;
    merkleRootPublic: string;
    labels: string[];
  };
  explanation?: {
    architecture: string;
    verifierPipelines: Array<{
      id: string;
      title: string;
      checks: string[];
    }>;
    privateWitnessSummary: string;
    publicSignalSummary: string;
  };
  stages: ZkStagePayload[];
  metrics: ZkMetricPayload[];
  stageProgress?: Record<string, number>;
  proverEvents?: ZkProverEventPayload[];
  verifierLog?: ZkVerifierLogPayload[];
  proverGeometry?: ProverGeometryPayload;
  verifierCrystal?: VerifierCrystalPayload;
  proofAssemblyProgress?: ProofAssemblyProgressPayload;
  verificationPayload?: ZkVerificationPayload;
};