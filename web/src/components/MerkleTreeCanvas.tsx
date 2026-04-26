"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MergeAnimationPayload, MerkleSnapshotPayload, ProofTracePayload } from "@/lib/contracts";
import type { UserVisualProfile } from "../lib/visualProfile";
import { toVisualProfileStyle } from "../lib/visualProfile";

type MerkleTreeCanvasProps = {
  snapshot: MerkleSnapshotPayload;
  proof: ProofTracePayload;
  onBuildComplete?: () => void;
  visualMode?: "classic" | "phantom";
  visualProfile: UserVisualProfile;
};

type BuildPhase = "idle" | "input-stream" | "leaf-building" | "tree-building" | "complete";

type NodeData = {
  hash: string;
  sum: string;
  userId?: string;
  isCurrentLeaf: boolean;
  highlighted: boolean;
  isRoot: boolean;
  isBuilt: boolean;
  isActiveLevel: boolean;
  level: number;
  index: number;
  mergeMeta?: MergeAnimationPayload;
  mergeTick: number;
  isPhantom: boolean;
  isPathNode: boolean;
  isPathRevealed: boolean;
};

type PacketTrack = {
  id: string;
  x: number;
  y: number;
  delayMs: number;
};

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function AnimatedCountValue({ target, runKey }: Readonly<{ target: number; runKey: number }>) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (runKey <= 0 || !Number.isFinite(target)) {
      return;
    }

    const durationMs = 680;
    const frames = 24;
    const stepMs = Math.max(24, Math.floor(durationMs / frames));
    let frame = 0;
    const timer = globalThis.setInterval(() => {
      frame += 1;
      const ratio = Math.min(1, frame / frames);
      setValue(Math.round(target * ratio));
      if (ratio >= 1) {
        globalThis.clearInterval(timer);
      }
    }, stepMs);

    return () => globalThis.clearInterval(timer);
  }, [target, runKey]);

  return <span className="font-semibold text-emerald-200">{value.toLocaleString()}</span>;
}

function MerkleNodeCard({ data }: NodeProps<Node<NodeData>>) {
  let border = "1px solid rgba(148, 163, 184, 0.35)";
  let background = "linear-gradient(145deg, rgba(17,24,39,0.92), rgba(15,23,42,0.88))";
  let nodeAnimation: string | undefined;
  const showNodeContent = !data.isPhantom || data.isRoot || data.isPathRevealed;

  if (data.isRoot) {
    border = "2px solid hsl(calc(var(--user-hue) + 54deg) 92% 68% / 0.95)";
    background = "linear-gradient(145deg, hsl(calc(var(--user-hue) + 32deg) 58% 24% / 0.85), rgba(30,41,59,0.92))";
    nodeAnimation = "atlas-root-glow calc(3.4s / var(--user-tempo, 1)) ease-in-out infinite";
  } else if (data.isPhantom && !data.isPathRevealed) {
    border = "1px solid rgba(148, 163, 184, 0.42)";
    background = "linear-gradient(140deg, rgba(10, 16, 32, 0.9), rgba(18, 30, 45, 0.78))";
    nodeAnimation = "phantom-node-breathe calc(2.4s / var(--user-tempo, 1)) ease-in-out infinite";
  } else if (data.isPhantom && data.isPathNode) {
    border = "2px solid hsl(var(--user-hue) 84% 60% / 0.95)";
    background = "linear-gradient(145deg, hsl(var(--user-hue) 62% 22% / 0.92), rgba(15, 23, 42, 0.9))";
    nodeAnimation = "phantom-path-pulse calc(1.2s / var(--user-tempo, 1)) ease-in-out infinite";
  } else if (data.highlighted) {
    border = "2px solid hsl(var(--user-hue) 84% 60% / 0.95)";
    background = "linear-gradient(145deg, hsl(var(--user-hue) 58% 18% / 0.92), rgba(17, 24, 39, 0.92))";
    nodeAnimation = "atlas-path-pulse calc(2.2s / var(--user-tempo, 1)) ease-in-out infinite";
  }

  const left = data.mergeMeta ? Number(data.mergeMeta.leftSum) : 0;
  const right = data.mergeMeta ? Number(data.mergeMeta.rightSum) : 0;
  const target = data.mergeMeta ? Number(data.mergeMeta.parentSum) : 0;
  const showSumInPrivacy = !data.isPhantom || data.isCurrentLeaf;

  return (
    <div
      style={{
        width: 172,
        borderRadius: 14,
        padding: 10,
        border,
        background,
        color: "#f8fafc",
        opacity: data.isBuilt ? 1 : 0.3,
        transform: data.isActiveLevel ? "scale(1.06)" : "scale(1)",
        transition: "transform 320ms ease, opacity 320ms ease, box-shadow 320ms ease",
        boxShadow: data.highlighted
          ? "0 0 0 1px hsl(var(--user-hue) 84% 60% / 0.45), 0 10px 26px hsl(var(--user-hue) 70% 50% / 0.2)"
          : "0 8px 22px rgba(2,6,23,0.35)",
        animation: nodeAnimation,
      }}
      className="text-[11px] leading-relaxed"
    >
      <Handle
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        style={{ opacity: 0, width: 8, height: 8, border: "none", background: "transparent" }}
      />

      {showNodeContent ? (
        <>
          <p className="font-semibold tracking-wide text-slate-100">{shortHash(data.hash)}</p>
          {showSumInPrivacy ? <p className="mt-1 text-slate-300">sum: {data.sum}</p> : null}
          <p className="text-slate-400">lvl {data.level} idx {data.index}</p>
          {data.userId ? <p className="text-lime-300">user: {data.userId}</p> : null}
        </>
      ) : (
        <>
          <p className="phantom-glyph-stream font-semibold tracking-wide text-cyan-100">*** ENCRYPTED ***</p>
          <p className="mt-1 text-slate-400">node locked</p>
          <p className="text-slate-500">lvl {data.level} idx {data.index}</p>
        </>
      )}

      {data.mergeMeta && data.isBuilt && data.isActiveLevel && showNodeContent && !data.isPhantom ? (
        <div className="mt-2 rounded-md border border-emerald-300/35 bg-emerald-500/10 px-2 py-1 text-[10px] atlas-merge-reveal">
          <p className="text-emerald-100">
            {left.toLocaleString()} + {right.toLocaleString()} = <AnimatedCountValue target={target} runKey={data.mergeTick} />
          </p>
          {data.mergeMeta.isSelfMerge ? <p className="text-amber-200">self-merge branch</p> : null}
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, width: 8, height: 8, border: "none", background: "transparent" }}
      />
    </div>
  );
}

const MERKLE_NODE_TYPES = { merkleNode: MerkleNodeCard };

export function MerkleTreeCanvas({
  snapshot,
  proof,
  onBuildComplete,
  visualMode = "classic",
  visualProfile,
}: Readonly<MerkleTreeCanvasProps>) {
  const maxBuildLevel = snapshot.levels.length - 1;
  const [buildLevel, setBuildLevel] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.2);
  const [buildPhase, setBuildPhase] = useState<BuildPhase>("input-stream");
  const [mergeTick, setMergeTick] = useState(0);
  const [pathRevealIndex, setPathRevealIndex] = useState(-1);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<NodeData>, Edge> | null>(null);
  const visualVars = useMemo(() => toVisualProfileStyle(visualProfile) as CSSProperties, [visualProfile]);

  const growsUpward = useMemo(() => {
    if (snapshot.levels.length < 2) {
      return true;
    }
    const firstLevelSize = snapshot.levels[0]?.length ?? 0;
    const lastLevelSize = snapshot.levels.at(-1)?.length ?? 0;
    return firstLevelSize >= lastLevelSize;
  }, [snapshot.levels]);

  const isAnimating = buildPhase === "tree-building" && isPlaying && buildLevel < maxBuildLevel;

  useEffect(() => {
    if (buildPhase !== "input-stream") {
      return;
    }

    const timers: Array<ReturnType<typeof globalThis.setTimeout>> = [];
    const isSingleLevelTree = snapshot.levels.length <= 1;
    const maxDelayMs = Math.max(0, ...(snapshot.leafGenerationSequence ?? []).map((step) => step.delayMs));
    const streamDuration = maxDelayMs + 980;

    const leafBuildTimer = globalThis.setTimeout(() => {
      setBuildPhase("leaf-building");
    }, Math.max(520, streamDuration - 180));

    const treeBuildTimer = globalThis.setTimeout(() => {
      if (isSingleLevelTree) {
        setBuildLevel(0);
        setBuildPhase("complete");
        setIsPlaying(false);
        return;
      }

      setBuildPhase("tree-building");
      setIsPlaying(true);
    }, Math.max(760, streamDuration + 80));

    timers.push(leafBuildTimer, treeBuildTimer);

    return () => {
      timers.forEach((timer) => globalThis.clearTimeout(timer));
    };
  }, [buildPhase, snapshot.leafGenerationSequence, snapshot.root.hash, snapshot.levels.length]);

  useEffect(() => {
    if (!isAnimating) {
      return;
    }

    const intervalMs = Math.max(220, Math.floor(950 / speed));
    const timer = globalThis.setInterval(() => {
      setMergeTick((tick) => tick + 1);
      setBuildLevel((currentLevel) => {
        const nextLevel = Math.min(maxBuildLevel, currentLevel + 1);

        if (nextLevel >= maxBuildLevel) {
          globalThis.clearInterval(timer);
          setBuildPhase("complete");
          setIsPlaying(false);
        }

        return nextLevel;
      });
    }, intervalMs);

    return () => globalThis.clearInterval(timer);
  }, [isAnimating, speed, maxBuildLevel]);

  useEffect(() => {
    if (buildPhase === "complete") {
      onBuildComplete?.();
    }
  }, [buildPhase, onBuildComplete]);

  useEffect(() => {
    if (!flowInstance) {
      return;
    }

    const rafId = globalThis.requestAnimationFrame(() => {
      flowInstance.fitView({
        padding: 0.18,
        duration: 380,
        minZoom: 0.35,
        maxZoom: 1.5,
      });
    });

    return () => globalThis.cancelAnimationFrame(rafId);
  }, [flowInstance, snapshot.root.hash]);

  const highlightedHashes = useMemo(() => {
    const nodes = new Set<string>();
    nodes.add(proof.rootHash);
    nodes.add(proof.steps[0]?.inputHash ?? "");
    for (const step of proof.steps) {
      nodes.add(step.outputHash);
      nodes.add(step.siblingHash);
    }
    nodes.delete("");
    return nodes;
  }, [proof]);

  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const level of snapshot.levels) {
      for (const node of level) {
        if (highlightedHashes.has(node.hash)) {
          ids.add(node.nodeId);
        }
      }
    }
    return ids;
  }, [snapshot, highlightedHashes]);

  const orderedPathNodeIds = useMemo(() => {
    const fromMetadata = snapshot.proofPhantomPath?.stepSequence.map((step) => step.treeNodeId) ?? [];
    const candidateIds = [...fromMetadata];
    if (candidateIds.at(-1) !== snapshot.root.nodeId) {
      candidateIds.push(snapshot.root.nodeId);
    }

    const dedupedIds: string[] = [];
    for (const nodeId of candidateIds) {
      if (nodeId && !dedupedIds.includes(nodeId)) {
        dedupedIds.push(nodeId);
      }
    }

    if (dedupedIds.length > 0) {
      return dedupedIds;
    }

    const sourceToParent = new Map(snapshot.edges.map((edge) => [edge.source, edge.target]));
    const levelZeroNodes = snapshot.levels[0] ?? [];
    const leafNode = levelZeroNodes.find((node) => String(node.userId ?? "") === proof.userId);
    if (!leafNode) {
      return [snapshot.root.nodeId];
    }

    const fallbackPathIds = [leafNode.nodeId];
    let currentNodeId = leafNode.nodeId;

    for (const proofStep of proof.steps) {
      if (!proofStep) {
        continue;
      }
      const parentNodeId = sourceToParent.get(currentNodeId);
      if (!parentNodeId) {
        break;
      }

      fallbackPathIds.push(parentNodeId);
      currentNodeId = parentNodeId;
    }

    if (!fallbackPathIds.includes(snapshot.root.nodeId)) {
      fallbackPathIds.push(snapshot.root.nodeId);
    }

    return fallbackPathIds;
  }, [snapshot, proof]);

  const pathNodeIndexById = useMemo(() => {
    const map = new Map<string, number>();
    orderedPathNodeIds.forEach((nodeId, index) => {
      map.set(nodeId, index);
    });
    return map;
  }, [orderedPathNodeIds]);

  const orderedPathEdgeIds = useMemo(() => {
    const edgeIds = new Set<string>();
    for (let index = 1; index < orderedPathNodeIds.length; index += 1) {
      const sourceId = orderedPathNodeIds[index - 1];
      const targetId = orderedPathNodeIds[index];
      edgeIds.add(`${sourceId}-${targetId}`);
    }
    return edgeIds;
  }, [orderedPathNodeIds]);

  const revealedPathNodeIds = useMemo(() => {
    if (visualMode !== "phantom") {
      return new Set(orderedPathNodeIds);
    }

    const maxSlice = Math.min(pathRevealIndex + 1, orderedPathNodeIds.length);
    return new Set(orderedPathNodeIds.slice(0, Math.max(maxSlice, 0)));
  }, [visualMode, pathRevealIndex, orderedPathNodeIds]);

  useEffect(() => {
    if (visualMode !== "phantom" || buildPhase !== "complete") {
      return;
    }

    if (orderedPathNodeIds.length === 0) {
      return;
    }

    const kickoff = globalThis.setTimeout(() => {
      setPathRevealIndex(0);
    }, 180);

    const revealIntervalMs = Math.max(260, Math.floor(520 / speed));
    const timer = globalThis.setInterval(() => {
      setPathRevealIndex((current) => {
        const next = Math.min(current + 1, orderedPathNodeIds.length - 1);
        if (next >= orderedPathNodeIds.length - 1) {
          globalThis.clearInterval(timer);
        }
        return next;
      });
    }, revealIntervalMs);

    return () => {
      globalThis.clearTimeout(kickoff);
      globalThis.clearInterval(timer);
    };
  }, [visualMode, buildPhase, orderedPathNodeIds, speed]);

  const mergeByParentId = useMemo(() => {
    const map = new Map<string, MergeAnimationPayload>();
    for (const mergeMeta of snapshot.mergeMetadata ?? []) {
      map.set(mergeMeta.parentNodeId, mergeMeta);
    }
    return map;
  }, [snapshot.mergeMetadata]);

  const layout = useMemo(() => {
    const maxLevel = snapshot.levels.length - 1;
    const spacingX = 210;
    const spacingY = 160;
    const maxNodesInAnyLevel = Math.max(...snapshot.levels.map((level) => level.length));
    const totalWidth = Math.max(maxNodesInAnyLevel * spacingX, 800);
    const positions = new Map<string, { x: number; y: number }>();

    for (const levelNodes of snapshot.levels) {
      const nodeCount = levelNodes.length;
      const rowWidth = Math.max((nodeCount - 1) * spacingX, 0);
      const rowStart = (totalWidth - rowWidth) / 2;

      for (const node of levelNodes) {
        const y = (maxLevel - node.level) * spacingY;
        const x = rowStart + node.index * spacingX;
        positions.set(node.nodeId, { x, y });
      }
    }

    return { maxLevel, positions };
  }, [snapshot.levels]);

  const activeLevel = useMemo(() => {
    if (buildPhase === "input-stream" || buildPhase === "idle") {
      return -1;
    }
    return growsUpward ? buildLevel : layout.maxLevel - buildLevel;
  }, [buildPhase, growsUpward, buildLevel, layout.maxLevel]);

  const packetTracks = useMemo(() => {
    if (buildPhase !== "input-stream" && buildPhase !== "leaf-building") {
      return [] as PacketTrack[];
    }

    const steps = snapshot.leafGenerationSequence ?? [];
    if (steps.length === 0) {
      return [] as PacketTrack[];
    }

    return steps
      .map((step) => {
        const target = layout.positions.get(step.targetNodeId);
        if (!target) {
          return null;
        }

        return {
          id: `${step.targetNodeId}-${step.delayMs}`,
          x: target.x + 70,
          y: target.y + 52,
          delayMs: step.delayMs,
        };
      })
      .filter((track): track is PacketTrack => Boolean(track));
  }, [buildPhase, snapshot.leafGenerationSequence, layout.positions]);

  const mergeBursts = useMemo(() => {
    if (activeLevel < 0) {
      return [] as Array<{ id: string; x: number; y: number }>;
    }

    return (snapshot.mergeMetadata ?? [])
      .filter((meta) => meta.level === activeLevel)
      .map((meta) => {
        const point = layout.positions.get(meta.parentNodeId);
        if (!point) {
          return null;
        }
        return {
          id: `${meta.parentNodeId}-${mergeTick}`,
          x: point.x + 84,
          y: point.y + 58,
        };
      })
      .filter((meta): meta is { id: string; x: number; y: number } => Boolean(meta));
  }, [activeLevel, snapshot.mergeMetadata, layout.positions, mergeTick]);

  const flowData = useMemo(() => {
    const nodeLevelById = new Map<string, number>();
    for (const levelNodes of snapshot.levels) {
      for (const node of levelNodes) {
        nodeLevelById.set(node.nodeId, node.level);
      }
    }

    const nodes: Node<NodeData>[] = snapshot.levels.flatMap((levelNodes) => {
      return levelNodes.map((node) => {
        const point = layout.positions.get(node.nodeId) ?? { x: 0, y: 0 };
        const isRoot = node.nodeId === snapshot.root.nodeId;
        const isHighlighted = highlightedHashes.has(node.hash);
        const isCurrentLeaf = String(node.userId ?? "") === proof.userId;
        const isPathNode = pathNodeIndexById.has(node.nodeId);
        const isPathRevealed =
          visualMode !== "phantom" ||
          isRoot ||
          (isPathNode && revealedPathNodeIds.has(node.nodeId));
        const isBuilt = activeLevel >= 0 && (growsUpward ? node.level <= activeLevel : node.level >= activeLevel);
        const isActiveLevel = node.level === activeLevel;
        return {
          id: node.nodeId,
          type: "merkleNode",
          position: point,
          data: {
            hash: node.hash,
            sum: node.sum,
            userId: node.userId,
            isCurrentLeaf,
            highlighted: isHighlighted,
            isRoot,
            isBuilt,
            isActiveLevel,
            level: node.level,
            index: node.index,
            mergeMeta: mergeByParentId.get(node.nodeId),
            mergeTick,
            isPhantom: visualMode === "phantom",
            isPathNode,
            isPathRevealed,
          },
          draggable: false,
          selectable: false,
          sourcePosition: Position.Top,
          targetPosition: Position.Bottom,
        };
      });
    });

    const edges: Edge[] = snapshot.edges.map((edge) => {
      const sourceLevel = nodeLevelById.get(edge.source) ?? 0;
      const targetLevel = nodeLevelById.get(edge.target) ?? 0;
      const sourceBuilt = activeLevel >= 0 && (growsUpward ? sourceLevel <= activeLevel : sourceLevel >= activeLevel);
      const targetBuilt = activeLevel >= 0 && (growsUpward ? targetLevel <= activeLevel : targetLevel >= activeLevel);
      const activeTransition = targetLevel === activeLevel;
      const isProofEdge = highlightedNodeIds.has(edge.source) && highlightedNodeIds.has(edge.target);
      const isPathEdge = orderedPathEdgeIds.has(`${edge.source}-${edge.target}`);
      const sourcePathIndex = pathNodeIndexById.get(edge.source) ?? -1;
      const targetPathIndex = pathNodeIndexById.get(edge.target) ?? -1;
      const isPathEdgeRevealed =
        visualMode !== "phantom" ||
        (sourcePathIndex >= 0 && targetPathIndex >= 0 && sourcePathIndex <= pathRevealIndex && targetPathIndex <= pathRevealIndex);

      let stroke = "rgba(71, 85, 105, 0.35)";
      if (sourceBuilt && targetBuilt) {
        stroke = "rgba(148, 163, 184, 0.85)";
      }
      if (visualMode === "phantom") {
        stroke = "rgba(148, 163, 184, 0.2)";
      }
      if (isProofEdge) {
        stroke = "hsl(var(--user-hue) 84% 60% / 0.95)";
      }
      if (visualMode === "phantom" && isPathEdge && isPathEdgeRevealed) {
        stroke = "hsl(calc(var(--user-hue) + 10deg) 86% 62% / 0.95)";
      }

      let strokeWidth = 1.4;
      if (activeTransition && sourceBuilt && targetBuilt) {
        strokeWidth = 2.2;
      }
      if (isProofEdge) {
        strokeWidth = 2.6;
      }
      if (visualMode === "phantom" && isPathEdge && isPathEdgeRevealed) {
        strokeWidth = 2.8;
      }

      let edgeAnimated = activeTransition && sourceBuilt && targetBuilt;
      if (isProofEdge) {
        edgeAnimated = true;
      }
      if (visualMode === "phantom") {
        edgeAnimated = isPathEdge && isPathEdgeRevealed;
      }

      return {
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        style: {
          stroke,
          strokeWidth,
        },
        animated: edgeAnimated,
      };
    });

    return { nodes, edges };
  }, [
    snapshot,
    layout,
    highlightedHashes,
    activeLevel,
    growsUpward,
    highlightedNodeIds,
    mergeByParentId,
    mergeTick,
    visualMode,
    pathNodeIndexById,
    revealedPathNodeIds,
    orderedPathEdgeIds,
    pathRevealIndex,
  ]);

  const stepLabel = `Stage ${buildLevel + 1} / ${maxBuildLevel + 1}`;

  function handlePlayPause() {
    if (buildPhase === "input-stream" || buildPhase === "leaf-building") {
      setPathRevealIndex(-1);
      if (maxBuildLevel === 0) {
        setBuildLevel(0);
        setBuildPhase("complete");
        setIsPlaying(false);
        return;
      }

      setBuildPhase("tree-building");
      setIsPlaying(true);
      return;
    }

    if (buildPhase === "complete" || buildPhase === "idle" || buildLevel >= maxBuildLevel) {
      setPathRevealIndex(-1);
      setBuildLevel(0);
      setMergeTick((tick) => tick + 1);
      if (maxBuildLevel === 0) {
        setBuildPhase("complete");
        setIsPlaying(false);
        return;
      }

      setBuildPhase("tree-building");
      setIsPlaying(true);
      return;
    }
    setIsPlaying((playing) => !playing);
  }

  function handleReset() {
    setPathRevealIndex(-1);
    setBuildLevel(0);
    setIsPlaying(false);
    setBuildPhase("idle");
  }

  function stepBackward() {
    setPathRevealIndex(-1);
    setIsPlaying(false);
    const nextLevel = Math.max(0, buildLevel - 1);
    setBuildLevel(nextLevel);
    setBuildPhase(nextLevel >= maxBuildLevel ? "complete" : "tree-building");
    setMergeTick((tick) => tick + 1);
  }

  function stepForward() {
    setPathRevealIndex(-1);
    setIsPlaying(false);
    const nextLevel = Math.min(maxBuildLevel, buildLevel + 1);
    setBuildLevel(nextLevel);
    setBuildPhase(nextLevel >= maxBuildLevel ? "complete" : "tree-building");
    setMergeTick((tick) => tick + 1);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-500/35 bg-slate-950/70" style={visualVars}>
      <div className="relative h-[72vh] min-h-155 w-full overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_15%,rgba(16,185,129,0.20),transparent_42%),radial-gradient(circle_at_78%_18%,rgba(59,130,246,0.16),transparent_36%),radial-gradient(circle_at_50%_78%,rgba(14,165,233,0.18),transparent_44%)]" />

        <div className="pointer-events-none absolute inset-0 z-10">
          {packetTracks.map((track) => (
            <span
              key={track.id}
              className="atlas-data-packet"
              style={{
                ["--atlas-packet-x" as string]: `${track.x}px`,
                ["--atlas-packet-y" as string]: `${track.y}px`,
                animationDelay: `${track.delayMs}ms`,
              }}
            />
          ))}

          {mergeBursts.map((burst) => (
            <span
              key={burst.id}
              className="atlas-merge-burst"
              style={{
                left: `${burst.x}px`,
                top: `${burst.y}px`,
              }}
            />
          ))}
        </div>

        <ReactFlow
          className="atlas-flow-pane"
          onInit={(instance) => setFlowInstance(instance)}
          nodes={flowData.nodes}
          edges={flowData.edges}
          nodeTypes={MERKLE_NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.35}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(148,163,184,0.18)" size={2} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="border-t border-slate-500/35 bg-slate-950/85 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePlayPause}
            className="rounded-lg border border-lime-300/40 bg-lime-500/10 px-3 py-1.5 text-sm text-lime-100 hover:bg-lime-500/20"
          >
            {isAnimating ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-400/35 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={stepBackward}
            className="rounded-lg border border-slate-400/35 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={stepForward}
            className="rounded-lg border border-slate-400/35 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800"
          >
            Next
          </button>

          <span className="rounded-md border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-xs uppercase tracking-[0.16em] text-emerald-200">
            {buildPhase}
          </span>

        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-emerald-200">{stepLabel}</p>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span>Speed</span>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="h-1.5 w-36 accent-lime-300"
            />
            <span className="w-10 text-right text-xs text-lime-200">{speed.toFixed(1)}x</span>
          </label>

          <span className="rounded-md border border-cyan-300/35 bg-cyan-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-cyan-100">
            {visualMode === "phantom" ? "Privacy overlay" : "Standard view"}
          </span>

          <input
            type="range"
            min={0}
            max={maxBuildLevel}
            value={buildLevel}
            onChange={(event) => {
              setPathRevealIndex(-1);
              setIsPlaying(false);
              const nextLevel = Number(event.target.value);
              setBuildLevel(nextLevel);
              setBuildPhase(nextLevel >= maxBuildLevel ? "complete" : "tree-building");
              setMergeTick((tick) => tick + 1);
            }}
            className="h-1.5 min-w-56 flex-1 accent-emerald-300"
          />
        </div>
      </div>
    </div>
  );
}
