import { NextResponse } from "next/server";
import {
  buildProofTrace,
  buildTreeSnapshot,
} from "../../../../../../src/treeSnapshot";

export const runtime = "nodejs";

type InputUserRow = { name?: string; accountId?: string; balance?: number | string };
type SnapshotNode = {
  nodeId: string;
  level: number;
  index: number;
  hash: string;
  hashShort: string;
  sum: string;
  userId?: string | null;
  leftChildId?: string;
  rightChildId?: string | null;
};

type TreeSnapshot = ReturnType<typeof buildTreeSnapshot>;
type ExtendedTreeSnapshot = TreeSnapshot & {
  leafGenerationSequence?: Array<{
    inputRowIndex: number;
    accountId: string;
    targetNodeId: string;
    delayMs: number;
  }>;
  mergeMetadata?: Array<{
    parentNodeId: string;
    leftChildId: string;
    rightChildId: string;
    leftSum: string;
    rightSum: string;
    parentSum: string;
    isSelfMerge: boolean;
    level: number;
    index: number;
  }>;
  proofPhantomPath?: {
    leafNodeId: string | null;
    rootNodeId: string;
    stepSequence: Array<{
      step: number;
      treeNodeId: string;
      position: "left" | "right" | "self";
      siblingNodeId: string | null;
      estimatedGateIndex: number;
    }>;
  };
  constraintSnapshot?: {
    balanceInputs: string[];
    partialSums: string[];
    totalLiabilities: string;
    constraintGateCount: number;
  };
};

const MAX_USERS = 256;

function normalizeUsers(rows: InputUserRow[]) {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const name = String(row?.name ?? "").trim();
    const accountId = String(row?.accountId ?? "").trim();
    const numericBalance = Number(row?.balance);

    if (!name) {
      throw new Error(`Row ${index + 1}: name is required`);
    }

    if (!accountId) {
      throw new Error(`Row ${index + 1}: accountId is required`);
    }

    if (seen.has(accountId)) {
      throw new Error(`Duplicate accountId '${accountId}' is not allowed`);
    }
    seen.add(accountId);

    if (!Number.isFinite(numericBalance) || numericBalance < 0) {
      throw new Error(`Row ${index + 1}: balance must be a non-negative number`);
    }

    return {
      id: accountId,
      balance: numericBalance,
      name,
      accountId,
    };
  });
}

function buildLeafGenerationSequence(
  rows: InputUserRow[],
  leafOrder: string[],
  levelZeroNodeByAccountId: Map<string, string>,
) {
  const inputIndexByAccountId = new Map<string, number>();
  rows.forEach((row, index) => {
    const accountId = String(row?.accountId ?? "").trim();
    if (accountId && !inputIndexByAccountId.has(accountId)) {
      inputIndexByAccountId.set(accountId, index);
    }
  });

  return leafOrder
    .map((accountId, sortedIndex) => {
      const targetNodeId = levelZeroNodeByAccountId.get(accountId);
      if (!targetNodeId) {
        return null;
      }

      return {
        inputRowIndex: inputIndexByAccountId.get(accountId) ?? sortedIndex,
        accountId,
        targetNodeId,
        delayMs: sortedIndex * 85,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function buildMergeMetadata(snapshot: TreeSnapshot) {
  const nodeById = new Map<string, SnapshotNode>();
  for (const level of snapshot.levels) {
    for (const node of level as SnapshotNode[]) {
      nodeById.set(node.nodeId, node as SnapshotNode);
    }
  }

  const metadata: Array<{
    parentNodeId: string;
    leftChildId: string;
    rightChildId: string;
    leftSum: string;
    rightSum: string;
    parentSum: string;
    isSelfMerge: boolean;
    level: number;
    index: number;
  }> = [];

  for (const level of snapshot.levels) {
    for (const node of level as SnapshotNode[]) {
      if (!node.leftChildId) {
        continue;
      }

      const left = nodeById.get(node.leftChildId);
      if (!left) {
        continue;
      }

      const rightChildId = node.rightChildId ?? node.leftChildId;
      const right = nodeById.get(rightChildId);

      metadata.push({
        parentNodeId: node.nodeId,
        leftChildId: node.leftChildId,
        rightChildId,
        leftSum: left.sum,
        rightSum: right?.sum ?? left.sum,
        parentSum: node.sum,
        isSelfMerge: !node.rightChildId,
        level: node.level,
        index: node.index,
      });
    }
  }

  return metadata;
}

function buildProofPhantomPath(
  snapshot: TreeSnapshot,
  proof: ReturnType<typeof buildProofTrace>,
) {
  const sourceToParent = new Map<string, string>();
  const parentToChildren = new Map<string, string[]>();

  for (const edge of snapshot.edges) {
    sourceToParent.set(edge.source, edge.target);
    const children = parentToChildren.get(edge.target) ?? [];
    children.push(edge.source);
    parentToChildren.set(edge.target, children);
  }

  const levelZeroNodes = (snapshot.levels[0] ?? []) as SnapshotNode[];
  const leafNode = levelZeroNodes.find((node) => String(node.userId ?? "") === proof.userId);
  const leafNodeId = leafNode?.nodeId ?? null;

  if (!leafNodeId) {
    return {
      leafNodeId: null,
      rootNodeId: snapshot.root.nodeId,
      stepSequence: [],
    };
  }

  const stepSequence: Array<{
    step: number;
    treeNodeId: string;
    position: "left" | "right" | "self";
    siblingNodeId: string | null;
    estimatedGateIndex: number;
  }> = [];

  let currentNodeId = leafNodeId;

  for (const proofStep of proof.steps) {
    const parentNodeId = sourceToParent.get(currentNodeId) ?? null;
    let siblingNodeId: string | null = null;

    if (parentNodeId) {
      const siblings = parentToChildren.get(parentNodeId) ?? [];
      siblingNodeId = siblings.find((nodeId) => nodeId !== currentNodeId) ?? currentNodeId;
    }

    stepSequence.push({
      step: proofStep.step,
      treeNodeId: currentNodeId,
      position: proofStep.position as "left" | "right" | "self",
      siblingNodeId,
      estimatedGateIndex: proofStep.step * 6 + 3,
    });

    if (parentNodeId) {
      currentNodeId = parentNodeId;
    }
  }

  stepSequence.push({
    step: proof.steps.length,
    treeNodeId: snapshot.root.nodeId,
    position: "self",
    siblingNodeId: null,
    estimatedGateIndex: proof.steps.length * 6 + 3,
  });

  return {
    leafNodeId,
    rootNodeId: snapshot.root.nodeId,
    stepSequence,
  };
}

function buildConstraintSnapshot(
  snapshot: TreeSnapshot,
  users: Array<{ id: string; balance: number }>,
  proofStepsCount: number,
) {
  const balanceById = new Map(users.map((user) => [user.id, user.balance]));
  const balanceInputs = snapshot.leafOrder.map((accountId) => String(balanceById.get(accountId) ?? 0));

  let cumulative = BigInt(0);
  const partialSums: string[] = [];
  for (const value of balanceInputs) {
    cumulative += BigInt(value);
    partialSums.push(cumulative.toString());
  }

  const baseConstraintBudget = Math.max(96, balanceInputs.length * 65);
  const pathConstraintBudget = proofStepsCount * 8;

  return {
    balanceInputs,
    partialSums,
    totalLiabilities: snapshot.root.sum,
    constraintGateCount: baseConstraintBudget + pathConstraintBudget,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const users = body?.users as InputUserRow[];
    const selectedUserId = body?.selectedUserId as string | undefined;

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: "users must be a non-empty array" }, { status: 400 });
    }

    if (users.length > MAX_USERS) {
      return NextResponse.json(
        { error: `users must not exceed ${MAX_USERS} rows for animated mode` },
        { status: 400 },
      );
    }

    const normalizedUsers = normalizeUsers(users);
    const focusUserId = selectedUserId ?? normalizedUsers[0].id;

    if (!normalizedUsers.some((user) => user.id === focusUserId)) {
      return NextResponse.json({ error: "selectedUserId must reference an existing accountId" }, { status: 400 });
    }

    const snapshot = buildTreeSnapshot(normalizedUsers) as ExtendedTreeSnapshot;
    const levelZeroNodes = (snapshot.levels[0] ?? []) as SnapshotNode[];
    const levelZeroNodeByAccountId = new Map(
      levelZeroNodes
        .filter((node) => Boolean(node.userId))
        .map((node) => [String(node.userId), node.nodeId]),
    );
    snapshot.leafGenerationSequence = buildLeafGenerationSequence(users, snapshot.leafOrder, levelZeroNodeByAccountId);
    snapshot.mergeMetadata = buildMergeMetadata(snapshot);
    const proof = buildProofTrace(normalizedUsers, focusUserId);
    snapshot.proofPhantomPath = buildProofPhantomPath(snapshot, proof);
    snapshot.constraintSnapshot = buildConstraintSnapshot(snapshot, normalizedUsers, proof.steps.length);

    return NextResponse.json({ snapshot, proof });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}